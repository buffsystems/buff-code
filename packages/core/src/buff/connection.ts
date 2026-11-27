export * as BuffConnectionPlugin from "./connection.js"

import path from "node:path"
import { Duration, Effect, Schema } from "effect"
import type { Scope } from "effect"
import { ToolFailure } from "@opencode/ai"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffChatConnections } from "@opencode/schema/buff-chat-connections"
import { BuffConnection } from "@opencode/schema/buff-connection"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { BuffSetup } from "@opencode/schema/buff-setup"
import { BuffSkill } from "@opencode/schema/buff-skill"
import { Mcp as McpSchema } from "@opencode/schema/mcp"
import { Form } from "../form.js"
import { Integration } from "../integration.js"
import { Mcp } from "../mcp/index.js"
import { Permission } from "../permission.js"
import { Session } from "../session.js"
import { QuestionTool } from "../tool/plugin/question.js"
import { BuffConnectionScript } from "./connection-script.js"
import { BuffAccountPkce } from "./account/pkce.js"
import { BuffConnectionText } from "./connection-text.js"
import { BuffLocale } from "./locale.js"
import { BuffProjectDir } from "./project-dir.js"
import { BuffSecret } from "./secret.js"
import authText from "./setup/prompts/connection-auth.md" with { type: "text" }
import instructionsText from "./setup/prompts/connection-instructions.md" with { type: "text" }
import listText from "./setup/prompts/connection-list.md" with { type: "text" }
import removeText from "./setup/prompts/connection-remove.md" with { type: "text" }
import saveText from "./setup/prompts/connection-save.md" with { type: "text" }
import scriptText from "./setup/prompts/connection-script.md" with { type: "text" }
import testText from "./setup/prompts/connection-test.md" with { type: "text" }

/**
 * Инструменты подключений режима «Настройка» (#765): модель сама сохраняет, проверяет, удаляет
 * MCP-серверы, проводит вход через сервис и записывает инструкции к подключению. Поверх
 * `buff.mcp` (файлы конфигурации), службы MCP (статус, инструменты, вызовы), интеграций (OAuth)
 * и `buff.skill` (инструкции). Сохранение и удаление подтверждает человек; названий сервисов нет.
 */

const SETTLE_EVERY = Duration.millis(500)
const SETTLE_FOR = Duration.seconds(30)
const SIGN_IN_FOR = Duration.minutes(10)

/** Описания инструментов — из файлов-шаблонов; наружу для тестов универсальности. */
export const descriptions = {
  list: listText,
  save: saveText,
  script: scriptText,
  test: testText,
  remove: removeText,
  auth: authText,
  instructions: instructionsText,
} as const

/** Connection tools any chat may call (#969): signing in, testing, listing, describing. */
const ANY_MODE: ReadonlySet<string> = new Set([
  BuffConnection.TOOLS.auth,
  BuffConnection.TOOLS.test,
  BuffConnection.TOOLS.list,
  BuffConnection.TOOLS.instructions,
])
export const anyMode = (tool: string) => ANY_MODE.has(tool)

/**
 * What keeps a connection tool from a connection outside Setup (R22-01): there the tools reach only
 * what the chat itself could. A trial call would bypass the tool path — the chat's «off», the origin
 * rules, the asks — so it stays Setup's; a project's (or project-personal) connection is not the
 * person's to start from a chat; one switched off (by the person or as over the operator's limit)
 * or turned off in this chat is not reached. Undefined — allowed.
 */
export function outsideSetupProblem(o: {
  readonly scope: BuffMcp.Entry["scope"]
  readonly status: string
  readonly off: boolean
  readonly trial: boolean
}): string | undefined {
  if (o.trial)
    return "A trial call is only for Self-setup mode. Here call this tool without `tool`, then call the connection's own tool."
  if (o.scope !== "user" && o.scope !== "builtin")
    return "This connection belongs to the project: it is tested and signed in to only in Self-setup mode. Tell the user."
  if (o.status === "disabled")
    return "This connection is turned off — by the user, or as one over the limit of connections. It cannot be tested or signed in to until the user turns it on; tell them."
  if (o.off)
    return "The user turned this connection off in this chat. Do not test it, sign in to it or reach the same service another way; tell the user — only they can turn it back on."
  return undefined
}

const fail = (message: string) => Effect.fail(new ToolFailure({ message }))
/** Значение как JSON: у настроек сервера из схемы — экземпляр класса, метаданным разрешения он не годится. */
export const plain = <A>(value: A): A => JSON.parse(JSON.stringify(value)) as A
const Name = Schema.String.annotate({ description: "The connection's name" })

export const SaveInput = Schema.Struct({
  name: Name,
  config: McpSchema.ServerConfig,
})
export const ScriptInput = Schema.Struct({
  name: Name,
  code: Schema.String.annotate({ description: "The whole TypeScript module" }),
  environment: Schema.Record(Schema.String, Schema.String).annotate({
    description: "Variables the script reads from process.env; values may be {secret:<id>} tokens",
  }),
})
export const TestInput = Schema.Struct({
  name: Name,
  tool: Schema.String.annotate({ description: "Empty outside Self-setup mode. In Self-setup mode: a harmless tool to call once, or empty to only reconnect and list" }),
  args: Schema.Record(Schema.String, Schema.Unknown).annotate({ description: "Arguments of the trial call" }),
})
export const TargetInput = Schema.Struct({ name: Name })
export const AuthInput = Schema.Struct({ name: Name })
export const InstructionsInput = Schema.Struct({
  name: Name,
  instructions: Schema.String.annotate({ description: "The instructions, markdown, in the user's language" }),
})
const Text = Schema.Struct({ text: Schema.String })

/** Сохранение и удаление подтверждает человек всегда; запрет остаётся запретом. */
export function confirmed(event: { readonly action: string; readonly effect: "allow" | "deny" | "ask" }) {
  const ours = event.action === BuffConnection.SAVE_ACTION || event.action === BuffConnection.REMOVE_ACTION
  return ours && event.effect === "allow" ? "ask" : event.effect
}

/**
 * Где хранить подключение из чата (#951) — решает место разговора, а не модель: в проекте новое
 * подключение действует только в нём, вне проекта — везде. Уже существующее остаётся где было:
 * повторное сохранение его чинит, а не переносит.
 */
export function scopeFor(existing: BuffMcp.Entry["scope"] | undefined, inProject: boolean): BuffMcp.Scope {
  if (existing && existing !== "builtin") return existing
  return inProject ? "local" : "user"
}

export const Plugin = define<
  | Mcp.Service
  | Form.Service
  | Integration.Service
  | Permission.Service
  | BuffSecret.Service
  | FSUtil.Service
  | Global.Service
  | Session.Service
  | Scope.Scope
>({
  id: "buff.connection",
  effect: Effect.fn(function* (ctx) {
    const mcp = yield* Mcp.Service
    const forms = yield* Form.Service
    const integrations = yield* Integration.Service
    const permission = yield* Permission.Service
    const secrets = yield* BuffSecret.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const sessions = yield* Session.Service
    const servers = ctx.rpc(BuffMcp.Rpc)
    const skills = ctx.rpc(BuffSkill.Rpc)
    /** Личная папка проекта; вне проекта её нет — и подключение сохраняется для всех. */
    const personal = yield* BuffProjectDir.personalFor(ctx.location.project)
    const project = path.basename(ctx.location.project.directory)
    type Context = { sessionID: string; agent: string; messageID: string; id: string }
    /** Кто входит сейчас (R14-01): клиент последнего запроса человека в главном чате (помощника
     *  ведёт агент главного), без запросов — метка рождения чата. */
    const signingFrom = (sessionID: string): Effect.Effect<unknown, unknown> =>
      Effect.gen(function* () {
        let session = yield* sessions.get(sessionID as never)
        for (let hops = 0; session.parentID && hops < 16; hops++) session = yield* sessions.get(session.parentID)
        const [latest] = yield* sessions.messages({ sessionID: session.id, type: "user", order: "desc", limit: 1 })
        const metadata = latest && "metadata" in latest ? (latest.metadata as Record<string, unknown> | undefined) : undefined
        return BuffConnection.signingClient(latest ? (metadata ?? {}) : undefined, session.metadata?.["origin"])
      })

    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        event.effect = confirmed(event)
      }),
    )

    // Changing a connection is Setup's; signing in to, testing, listing and describing one work in
    // any chat (#969): on the cloud the person adds connections in «Подключения» and signs in from
    // a normal chat — and on a computer a configured server is signed in to from where it is needed.
    const setupOnly = (name: string, context: Context) =>
      anyMode(name) || context.agent === BuffSetup.AGENT
        ? Effect.void
        : fail("Saving, scripting and removing connections are only for Self-setup mode. Tell the user.")
    const rpcFailure = (error: { readonly message: string }) => new ToolFailure({ message: error.message })
    const chatConnections = ctx.rpc(BuffChatConnections.Rpc)
    /** Turned off in this chat or the chat it helps (R13-07): the chat's own switch. */
    const offHere = (sessionID: string, name: string) =>
      Effect.gen(function* () {
        let id: string | undefined = sessionID
        for (let hops = 0; id && hops < 16; hops++) {
          const off = yield* chatConnections.get({ sessionID: id }).pipe(Effect.orElseSucceed(() => ({ off: [] as readonly string[] })))
          if (off.off.includes(name)) return true
          const session: { parentID?: string } | undefined = yield* sessions
            .get(id as never)
            .pipe(Effect.orElseSucceed(() => undefined))
          id = session?.parentID
        }
        return false
      })
    /** Outside Setup, the guard of R22-01 over the named connection; in Setup — nothing. */
    const reachable = (name: string, context: Context, trial: boolean) =>
      Effect.gen(function* () {
        if (context.agent === BuffSetup.AGENT) return
        const entry = yield* entryOf(name)
        const status = (yield* mcp.servers()).find((item) => item.name === name)?.status.status ?? "pending"
        const problem = outsideSetupProblem({
          scope: entry.scope,
          status,
          off: yield* offHere(context.sessionID, name),
          trial,
        })
        if (problem) return yield* fail(problem)
      })
    const found = (name: string) =>
      servers.list().pipe(
        Effect.mapError(rpcFailure),
        Effect.map((entries) => entries.find((item) => item.name === name)),
      )
    const entryOf = (name: string) =>
      found(name).pipe(
        Effect.flatMap((entry) =>
          entry ? Effect.succeed(entry) : fail(`No connection named «${name}». Call connection_list.`),
        ),
      )
    const scopeOf = (name: string) =>
      found(name).pipe(Effect.map((entry) => scopeFor(entry?.scope, personal !== undefined)))
    /** Статус после попытки соединения: ждём, пока он перестанет быть «подключается». */
    const settled = (name: string) =>
      Effect.gen(function* () {
        const deadline = Date.now() + Duration.toMillis(SETTLE_FOR)
        while (true) {
          const found = (yield* mcp.servers()).find((server) => server.name === name)
          if (found && found.status.status !== "pending") return found.status
          if (Date.now() > deadline) return found?.status ?? { status: "pending" as const }
          yield* Effect.sleep(SETTLE_EVERY)
        }
      })
    const toolsOf = (name: string) =>
      mcp.tools().pipe(Effect.map((tools) => tools.filter((tool) => String(tool.server) === name)))
    const report = (name: string) =>
      Effect.gen(function* () {
        const status = yield* settled(name)
        const tools = status.status === "connected" ? yield* toolsOf(name) : []
        return BuffConnectionText.status(name, status, tools)
      })
    const ask = (context: Context, action: string, resources: string[], metadata: Record<string, unknown>) =>
      permission
        .assert({
          action,
          resources,
          metadata,
          sessionID: context.sessionID as never,
          agent: context.agent as never,
          source: { type: "tool", messageID: context.messageID as never, id: context.id as never },
        })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied", error })))

    const add = <I extends Schema.Codec<any, any>>(
      name: string,
      description: string,
      input: I,
      run: (input: Schema.Schema.Type<I>, context: Context) => Effect.Effect<string, ToolFailure>,
    ) =>
      ctx.tool
        .transform((editor) =>
          editor.add({
            name,
            options: { codemode: false },
            description: description.trim(),
            input,
            output: Text,
            execute: (value, context) =>
              setupOnly(name, context).pipe(
                // Тип входа инструмента выводится из схемы иначе, чем `Schema.Type`, но это одно и то же значение.
                Effect.andThen(run(value as Schema.Schema.Type<I>, context)),
                Effect.map((text) => ({ output: { text }, content: text, metadata: {} })),
              ),
          }),
        )
        .pipe(Effect.orDie)

    yield* add(BuffConnection.TOOLS.list, listText, Schema.Struct({}), (_, context) =>
      Effect.gen(function* () {
        const entries = yield* servers.list().pipe(Effect.mapError(rpcFailure))
        const tools = yield* mcp.tools()
        const off = new Set<string>()
        for (const entry of entries) if (yield* offHere(context.sessionID, entry.name)) off.add(entry.name)
        return BuffConnectionText.list(entries, tools, off)
      }),
    )

    yield* add(BuffConnection.TOOLS.save, saveText, SaveInput, (input, context) =>
      Effect.gen(function* () {
        const name = input.name.trim()
        const problem = BuffMcp.nameProblem(name, BuffLocale.t) ?? BuffMcp.configProblem(input.config, BuffLocale.t)
        if (problem) return yield* fail(problem)
        const scope = yield* scopeOf(name)
        // Настройки в запросе разрешения — простым JSON: класс схемы не пройдёт в ответ API (#765, e2e).
        yield* ask(
          context,
          BuffConnection.SAVE_ACTION,
          BuffConnection.saveConfirmation({ name, scope, project, config: input.config }, BuffLocale.t),
          { scope, name, config: plain(input.config) },
        )
        yield* servers.save({ scope, name, config: input.config }).pipe(Effect.mapError(rpcFailure))
        return `${BuffConnectionText.saved(scope, project)}\n${yield* report(name)}`
      }),
    )

    yield* add(BuffConnection.TOOLS.test, testText, TestInput, (input, context) =>
      Effect.gen(function* () {
        yield* entryOf(input.name)
        yield* reachable(input.name, context, input.tool.trim() !== "")
        // Всегда заново: правленый скрипт или настройки подхватываются только перезапуском.
        yield* mcp.disconnect(input.name).pipe(Effect.ignore)
        yield* mcp.connect(input.name).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
        const status = yield* report(input.name)
        const tool = input.tool.trim()
        if (!tool) return status
        const result = yield* mcp.callTool({ server: input.name, name: tool, args: input.args }).pipe(
          Effect.map(BuffConnectionText.callResult),
          Effect.catch((error) => Effect.succeed(error.message)),
        )
        return `${status}\n\nTrial call ${tool}: ${result}`
      }),
    )

    yield* add(BuffConnection.TOOLS.script, scriptText, ScriptInput, (input, context) =>
      Effect.gen(function* () {
        const name = input.name.trim()
        const problem = BuffMcp.nameProblem(name, BuffLocale.t) ?? BuffConnectionScript.problem(input.code)
        if (problem) return yield* fail(problem)
        const scope = yield* scopeOf(name)
        // Скрипт подключения «только в этом проекте» лежит в личной папке проекта, рядом с записью.
        const files = BuffConnectionScript.paths(scope === "local" && personal ? personal : global.config, name)
        const config = BuffConnectionScript.config(files, input.environment)
        yield* ask(
          context,
          BuffConnection.SAVE_ACTION,
          [
            ...BuffConnection.saveConfirmation({ name, scope, project, config }, BuffLocale.t),
            BuffLocale.t("File: {file}", { file: files.script }),
          ],
          { scope, name, config, script: files.script },
        )
        const unwritable = (error: Error) =>
          new ToolFailure({ message: `Could not write the script: ${error.message}` })
        const current = yield* fs.readFileStringSafe(files.runner).pipe(Effect.orElseSucceed(() => undefined))
        if (BuffConnectionScript.stale(current))
          yield* fs.writeWithDirs(files.runner, BuffConnectionScript.stamped).pipe(Effect.mapError(unwritable))
        yield* fs.writeWithDirs(files.script, input.code).pipe(Effect.mapError(unwritable))
        yield* servers.save({ scope, name, config }).pipe(Effect.mapError(rpcFailure))
        return `Script saved to ${files.script}; edit it there to improve the connection, then run connection_test.\n${BuffConnectionText.saved(scope, project)}\n${yield* report(name)}`
      }),
    )

    yield* add(BuffConnection.TOOLS.remove, removeText, TargetInput, (input, context) =>
      Effect.gen(function* () {
        const entry = yield* entryOf(input.name)
        if (entry.scope === "builtin") return yield* fail(`«${input.name}» is built in and cannot be removed.`)
        const ids = entry.config ? BuffConnection.referencedSecrets(entry.config) : []
        yield* ask(
          context,
          BuffConnection.REMOVE_ACTION,
          BuffConnection.removeConfirmation({ name: input.name, secrets: ids.length }, BuffLocale.t),
          { scope: entry.scope, name: input.name },
        )
        yield* servers.remove({ scope: entry.scope, name: input.name }).pipe(Effect.mapError(rpcFailure))
        yield* Effect.forEach(ids, (id) => secrets.remove(id))
        return `Connection «${input.name}» removed${ids.length ? ` with ${ids.length} secret(s)` : ""}.`
      }),
    )

    yield* add(BuffConnection.TOOLS.auth, authText, AuthInput, (input, context) =>
      Effect.gen(function* () {
        const server = (yield* mcp.servers()).find((item) => item.name === input.name)
        if (!server) return yield* fail(`No connection named «${input.name}». Call connection_list.`)
        yield* reachable(input.name, context, false)
        if (!server.integrationID)
          return yield* fail("This connection does not sign in through the service: it is local, or takes a key.")
        const integration = yield* integrations.get(server.integrationID)
        const method = integration?.methods.find((item) => item.type === "oauth")
        if (!method || method.type !== "oauth") return yield* fail("This connection has no sign-in method.")
        // С телефона (#780) браузер не дойдёт до loopback машины: сервис вернёт в приложение Buff,
        // и оно само ответит на форму кодом. Из веб-клиента (#969) — на его страницу /oauth, и она
        // так же ответит. С компьютера код не нужен, но поле на всякий случай есть.
        const back = yield* signingFrom(context.sessionID).pipe(
          Effect.map((client) => BuffConnection.returnTo(client, BuffAccountPkce.webOrigin(process.env))),
          Effect.orElseSucceed(() => undefined),
        )
        const attempt = yield* integrations.oauth
          .connect({
            integrationID: server.integrationID,
            methodID: method.id,
            ...(back ? { answer: { redirect_uri: back } } : {}),
          })
          .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
        const handoff = BuffConnection.oauthState(attempt.url)
        const state = yield* forms
          .ask({
            sessionID: context.sessionID as never,
            title: BuffLocale.t("Sign in to «{name}»", { name: input.name }),
            metadata: {
              kind: "setup",
              tool: { messageID: context.messageID, id: context.id },
              ...(handoff ? { oauth: { state: handoff } } : {}),
            },
            fields: [
              { key: "open", type: "external", url: attempt.url, title: BuffLocale.t("Open and sign in") },
              {
                key: "code",
                type: "string" as const,
                required: attempt.mode === "code" || back !== undefined,
                title: BuffLocale.t("Code the service showed you"),
                description: BuffLocale.t(
                  "Comes by itself when you return to the app; or paste the address of the page you ended up on",
                ),
              },
            ],
          })
          .pipe(Effect.orDie)
        if (state.status === "cancelled") {
          yield* integrations.oauth.cancel({ integrationID: server.integrationID, attemptID: attempt.attemptID })
          return yield* Effect.die(new QuestionTool.CancelledError())
        }
        const code = typeof state.answer.code === "string" ? state.answer.code.trim() : undefined
        if (code)
          yield* integrations.oauth
            .complete({ integrationID: server.integrationID, attemptID: attempt.attemptID, code })
            .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
        const outcome = yield* signedIn(server.integrationID, attempt.attemptID)
        if (outcome !== "complete") return `Sign-in ${outcome}. ${yield* report(input.name)}`
        return `Sign-in complete. ${yield* report(input.name)}`
      }),
    )
    const signedIn = (integrationID: Integration.ID, attemptID: Integration.AttemptID) =>
      Effect.gen(function* () {
        const deadline = Date.now() + Duration.toMillis(SIGN_IN_FOR)
        while (Date.now() < deadline) {
          const status = yield* integrations.oauth
            .status({ integrationID, attemptID })
            .pipe(Effect.orElseSucceed(() => ({ status: "expired" as const })))
          if (status.status === "failed") return `failed: ${status.message}`
          if (status.status !== "pending") return status.status
          yield* Effect.sleep(Duration.seconds(1))
        }
        return "expired"
      })

    yield* add(BuffConnection.TOOLS.instructions, instructionsText, InstructionsInput, (input) =>
      Effect.gen(function* () {
        const entry = yield* entryOf(input.name)
        // Инструкции лежат там же, где подключение: в другом проекте без него они не нужны (#951).
        const scope = entry.scope === "builtin" ? "user" : entry.scope
        const id = BuffConnection.skillID(input.name)
        yield* skills
          .save({
            scope,
            id,
            name: BuffLocale.t("Connection «{name}»", { name: input.name }),
            description: BuffLocale.t("How to use the «{name}» connection: its tools, limits and quirks", {
              name: input.name,
            }),
            body: input.instructions.trim(),
          })
          .pipe(Effect.mapError(rpcFailure))
        return `Instructions for «${input.name}» saved as skill ${id}; later sessions read them when the connection is relevant.`
      }),
    )
  }),
})
