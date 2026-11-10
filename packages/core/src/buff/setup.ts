export * as BuffSetupPlugin from "./setup.js"

import path from "path"
import { Effect, Schema } from "effect"
import type { Scope } from "effect"
import { SystemPart, ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { BuffSetup } from "@opencode/schema/buff-setup"
import { Location } from "@opencode/schema/location"
import { Global } from "@opencode/util/global"
import { Permission } from "../permission.js"
import { Session } from "../session.js"
import { SessionSchema } from "../session/schema.js"
import { BuffLocale } from "./locale.js"
import modeText from "./setup/prompts/mode.md" with { type: "text" }
import offerText from "./setup/prompts/offer.md" with { type: "text" }

/**
 * Режим «Настройка» (#765): агент `setup` с собственными инструкциями из `setup/prompts/mode.md`,
 * вставка «предложи настройку» для остальных режимов из `offer.md`, инструмент `session_open`
 * (из обычного чата — в новую сессию настройки, после подтверждения человеком), RPC и команда
 * `/setup` для окна, консоли и телефона. Ни одного названия сервиса: режим универсален.
 */

const SETUP = Agent.ID.make(BuffSetup.AGENT)
const LANGUAGE = { ru: "Russian", en: "English" } as const

export const description = `Open a new Setup session for the user: there the agent connects itself to an external service, account, data source or folder the user needs, asking them plain questions and testing the result. The user confirms the switch before the session opens.

Call it right after the user agrees to set up a connection you do not have. Do not call it to do the user's task yourself, and never to ask for credentials in this conversation.

- title: short name of what is being connected, in the user's language.
- task: a self-contained task for the new session that cannot see this conversation: the outcome the user wants, and anything they already told you (which service, which account, what for).`

export const Input = Schema.Struct({
  title: Schema.String.annotate({ description: "Short name of what is being connected" }),
  task: Schema.String.annotate({ description: "Self-contained task for the setup session" }),
})
export type Input = typeof Input.Type

const Output = Schema.Struct({ session: Schema.String })

/** Инструкции режима для системного промпта: свои — агенту настройки, «предложи настройку» — остальным. */
export function systemPart(agent: string, locale: keyof typeof LANGUAGE = BuffLocale.current()): string {
  if (agent === BuffSetup.AGENT) return modeText.trim().replace("{{language}}", LANGUAGE[locale])
  return offerText.trim()
}

/** Переход подтверждает человек всегда: правило «разрешить всё» его не пропускает; запрет остаётся. */
export function confirmed(event: { readonly action: string; readonly effect: "allow" | "deny" | "ask" }) {
  return event.action === BuffSetup.PERMISSION_ACTION && event.effect === "allow" ? "ask" : event.effect
}

export function resources(input: Input): string[] {
  return BuffSetup.confirmation(input, BuffLocale.t)
}

export function reply(session: string): string {
  return `Setup session ${session} is open and already working on the task. Tell the user in one line that the setup continues in a new conversation, then stop; do not repeat the task here.`
}

export const Plugin = define<Permission.Service | Session.Service | Global.Service | Scope.Scope>({
  id: "buff.setup",
  effect: Effect.fn(function* (ctx) {
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const global = yield* Global.Service
    const config = path.join(global.config, "*")
    const location = Schema.decodeUnknownSync(Location.Ref)({
      directory: ctx.location.directory,
      ...(ctx.location.workspaceID ? { workspaceID: ctx.location.workspaceID } : {}),
    })

    yield* ctx.agent.transform((editor) => {
      editor.update(SETUP, (item) => {
        item.name = Agent.Name.make("Setup")
        item.description =
          "Connects the agent to external services, accounts, sources and folders the user needs, in plain words, and improves its own connections, skills and instructions with permission."
        item.mode = "primary"
        item.permissions.push(
          { action: "question", resource: "*", effect: "allow" },
          { action: "edit", resource: "*", effect: "deny" },
          { action: "edit", resource: config, effect: "allow" },
          { action: "external_directory", resource: config, effect: "allow" },
        )
      })
    })

    // Инструкции режима — частью системного промпта, не сообщением: промпт модели остаётся общим.
    // «Предложи настройку» — только тем, у кого есть инструмент перехода.
    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => {
        if (event.agent !== SETUP && !(BuffSetup.TOOL in event.tools)) return
        event.system.push(SystemPart.make(systemPart(event.agent)))
      }),
    )

    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.agent !== SETUP || event.status !== "error") return Effect.void
      if (event.tool !== "edit" && event.tool !== "write" && event.tool !== "patch") return Effect.void
      if (!(event.error.error instanceof Permission.BlockedError)) return Effect.void
      event.error = new ToolFailure({
        message: `Setup mode edits only your configuration folder: ${global.config}. Project files stay untouched.`,
      })
      return Effect.void
    })

    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        event.effect = confirmed(event)
      }),
    )

    // Событие «открыта» — после регистрации RPC; до неё никто не слушает.
    let announce: (data: BuffSetup.Opened) => Effect.Effect<void> = () => Effect.void
    const open = (input: { title?: string; text?: string; from?: string }): Effect.Effect<string, unknown> =>
      Effect.gen(function* () {
        const session = yield* sessions.create({
          agent: SETUP,
          ...(input.title ? { title: input.title } : {}),
          location,
        })
        if (input.text) yield* sessions.prompt({ sessionID: session.id, text: input.text })
        yield* announce({ session: session.id, ...(input.from ? { from: input.from } : {}) })
        return session.id as string
      })

    const registration = yield* ctx.rpc
      .register(BuffSetup.Rpc, {
        open: ({ text }) =>
          open({ ...(text?.trim() ? { text: text.trim() } : {}) }).pipe(
            Effect.map((session) => ({ session })),
            Effect.orDie,
          ),
      })
      .pipe(Effect.orDie)
    announce = (data) => registration.events.emit("opened", data).pipe(Effect.ignore)

    yield* ctx.command
      .transform((editor) =>
        editor.add({
          name: "setup",
          description: BuffLocale.t("Setup: a new session where the agent connects itself to what you need"),
          // Переход из переписки — с её номером: консоль и окно открывают новую сессию рядом.
          execute: (input) =>
            open({ ...(input.prompt.text.trim() ? { text: input.prompt.text.trim() } : {}), from: input.sessionID }).pipe(
              Effect.orDie,
            ),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: BuffSetup.TOOL,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (context.agent === SETUP)
                return yield* Effect.fail(new ToolFailure({ message: "You are already in Setup mode." }))
              const title = input.title.trim()
              const task = input.task.trim()
              if (!title || !task)
                return yield* Effect.fail(new ToolFailure({ message: "Both title and task are required." }))
              yield* permission.assert({
                action: BuffSetup.PERMISSION_ACTION,
                resources: resources({ title, task }),
                metadata: { title, task },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const session = yield* open({ title, text: task, from: context.sessionID })
              return { output: { session }, content: reply(session), metadata: { session } }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: "Unable to open the setup session", error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
})
