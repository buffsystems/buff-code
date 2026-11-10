export * as BuffConnectionPlugin from "./connection.js"

import { Duration, Effect, Schema } from "effect"
import type { Scope } from "effect"
import { ToolFailure } from "@opencode/ai"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { define } from "@opencode/plugin/effect/plugin"
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
import { BuffConnectionText } from "./connection-text.js"
import { BuffLocale } from "./locale.js"
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

const fail = (message: string) => Effect.fail(new ToolFailure({ message }))
/** Значение как JSON: у настроек сервера из схемы — экземпляр класса, метаданным разрешения он не годится. */
export const plain = <A>(value: A): A => JSON.parse(JSON.stringify(value)) as A
const Name = Schema.String.annotate({ description: "The connection's name" })

export const SaveInput = Schema.Struct({
  scope: BuffMcp.Scope.annotate({ description: "user — all projects; project — this project only" }),
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
  tool: Schema.String.annotate({ description: "A harmless tool to call once; empty to only reconnect and list" }),
  args: Schema.Record(Schema.String, Schema.Unknown).annotate({ description: "Arguments of the trial call" }),
})
export const TargetInput = Schema.Struct({ scope: BuffMcp.Scope, name: Name })
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
    type Context = { sessionID: string; agent: string; messageID: string; id: string }

    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        event.effect = confirmed(event)
      }),
    )

    const setupOnly = (context: Context) =>
      context.agent === BuffSetup.AGENT ? Effect.void : fail("Connection tools are only for Setup mode.")
    const rpcFailure = (error: { readonly message: string }) => new ToolFailure({ message: error.message })
    const entryOf = (name: string) =>
      servers.list().pipe(
        Effect.mapError(rpcFailure),
        Effect.flatMap((entries) => {
          const entry = entries.find((item) => item.name === name)
          return entry ? Effect.succeed(entry) : fail(`No connection named «${name}». Call connection_list.`)
        }),
      )
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
              setupOnly(context).pipe(
                // Тип входа инструмента выводится из схемы иначе, чем `Schema.Type`, но это одно и то же значение.
                Effect.andThen(run(value as Schema.Schema.Type<I>, context)),
                Effect.map((text) => ({ output: { text }, content: text, metadata: {} })),
              ),
          }),
        )
        .pipe(Effect.orDie)

    yield* add(BuffConnection.TOOLS.list, listText, Schema.Struct({}), () =>
      Effect.gen(function* () {
        const entries = yield* servers.list().pipe(Effect.mapError(rpcFailure))
        const tools = yield* mcp.tools()
        return BuffConnectionText.list(entries, tools)
      }),
    )

    yield* add(BuffConnection.TOOLS.save, saveText, SaveInput, (input, context) =>
      Effect.gen(function* () {
        const name = input.name.trim()
        const problem = BuffMcp.nameProblem(name, BuffLocale.t) ?? BuffMcp.configProblem(input.config, BuffLocale.t)
        if (problem) return yield* fail(problem)
        // Настройки в запросе разрешения — простым JSON: класс схемы не пройдёт в ответ API (#765, e2e).
        yield* ask(
          context,
          BuffConnection.SAVE_ACTION,
          BuffConnection.saveConfirmation({ ...input, name }, BuffLocale.t),
          { scope: input.scope, name, config: plain(input.config) },
        )
        yield* servers.save({ scope: input.scope, name, config: input.config }).pipe(Effect.mapError(rpcFailure))
        return yield* report(name)
      }),
    )

    yield* add(BuffConnection.TOOLS.test, testText, TestInput, (input) =>
      Effect.gen(function* () {
        yield* entryOf(input.name)
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
        const files = BuffConnectionScript.paths(global.config, name)
        const config = BuffConnectionScript.config(files, input.environment)
        yield* ask(
          context,
          BuffConnection.SAVE_ACTION,
          [
            ...BuffConnection.saveConfirmation({ name, scope: "user", config }, BuffLocale.t),
            BuffLocale.t("File: {file}", { file: files.script }),
          ],
          { scope: "user", name, config, script: files.script },
        )
        const unwritable = (error: Error) =>
          new ToolFailure({ message: `Could not write the script: ${error.message}` })
        const current = yield* fs.readFileStringSafe(files.runner).pipe(Effect.orElseSucceed(() => undefined))
        if (BuffConnectionScript.stale(current))
          yield* fs.writeWithDirs(files.runner, BuffConnectionScript.stamped).pipe(Effect.mapError(unwritable))
        yield* fs.writeWithDirs(files.script, input.code).pipe(Effect.mapError(unwritable))
        yield* servers.save({ scope: "user", name, config }).pipe(Effect.mapError(rpcFailure))
        return `Script saved to ${files.script}; edit it there to improve the connection, then run connection_test.\n${yield* report(name)}`
      }),
    )

    yield* add(BuffConnection.TOOLS.remove, removeText, TargetInput, (input, context) =>
      Effect.gen(function* () {
        const entry = yield* entryOf(input.name)
        const ids = entry.config ? BuffConnection.referencedSecrets(entry.config) : []
        yield* ask(
          context,
          BuffConnection.REMOVE_ACTION,
          BuffConnection.removeConfirmation({ name: input.name, secrets: ids.length }, BuffLocale.t),
          { scope: input.scope, name: input.name },
        )
        yield* servers.remove({ scope: input.scope, name: input.name }).pipe(Effect.mapError(rpcFailure))
        yield* Effect.forEach(ids, (id) => secrets.remove(id))
        return `Connection «${input.name}» removed${ids.length ? ` with ${ids.length} secret(s)` : ""}.`
      }),
    )

    yield* add(BuffConnection.TOOLS.auth, authText, AuthInput, (input, context) =>
      Effect.gen(function* () {
        const server = (yield* mcp.servers()).find((item) => item.name === input.name)
        if (!server) return yield* fail(`No connection named «${input.name}». Call connection_list.`)
        if (!server.integrationID)
          return yield* fail("This connection does not sign in through the service: it is local, or takes a key.")
        const integration = yield* integrations.get(server.integrationID)
        const method = integration?.methods.find((item) => item.type === "oauth")
        if (!method || method.type !== "oauth") return yield* fail("This connection has no sign-in method.")
        // С телефона (#780) браузер не дойдёт до loopback машины: сервис вернёт в приложение Buff,
        // и оно само ответит на форму кодом. С компьютера код не нужен, но поле на всякий случай есть.
        const phone = yield* sessions.get(context.sessionID as never).pipe(
          Effect.map((session) => session.metadata?.["origin"] === "phone"),
          Effect.orElseSucceed(() => false),
        )
        const attempt = yield* integrations.oauth
          .connect({
            integrationID: server.integrationID,
            methodID: method.id,
            ...(phone ? { answer: { redirect_uri: BuffConnection.APP_LINK } } : {}),
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
                required: attempt.mode === "code" || phone,
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
        const scope = entry.scope === "project" ? "project" : "user"
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
