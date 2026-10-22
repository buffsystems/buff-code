export * as WorkflowSessionPort from "./session-port.js"

import { Effect, Schema } from "effect"
import { Location } from "@opencode/schema/location"
import type { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { SubagentCompletion } from "../../session/subagent-completion.js"
import { BuffLocale } from "../locale.js"
import type { WorkflowEngine } from "./engine.js"
import { WorkflowPolicy } from "./policy.js"

/**
 * Сессии ядра для сценариев (#448): актёр — дочерняя сессия от сессии прогона, сессия прогона
 * из списка — новая сессия в проекте; актёр не запускает своих сценариев, но сдаёт результат; итог и вопросы — синтетическим сообщением, которое будит
 * модель этой сессии. Только перевод вызовов двигателя в `Session.Service`.
 */

const decodeLocation = Schema.decodeUnknownSync(Location.Ref)
const id = (value: string) => SessionSchema.ID.make(value)
const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect as Effect.Effect<A>)

export function make(sessions: Session.Interface): WorkflowEngine.Sessions {
  const recent = (session: string) => run(sessions.messages({ sessionID: id(session), order: "desc", limit: 20 }))
  return {
    create: async (input) => {
      const parent = await run(sessions.get(id(input.parent)))
      const info = await run(
        sessions.create({
          parentID: id(input.parent),
          title: input.title,
          metadata: input.metadata as never,
          permissions: WorkflowPolicy.actorRules(parent.permissions ?? []),
        }),
      )
      return info.id
    },
    createRoot: (input) =>
      run(sessions.create({ title: input.title, location: decodeLocation({ directory: input.directory }) })).then(
        (info) => info.id,
      ),
    prompt: (input) =>
      run(sessions.prompt({ sessionID: id(input.session), text: input.text })).then((admitted) => ({
        message: admitted.id,
      })),
    wait: (session) => run(sessions.wait(id(session))),
    state: async (session) => {
      const info = await run(sessions.get(id(session)))
      const failed =
        info.outcome === "failed"
          ? (await recent(session)).find((message) => message.type === "assistant" && message.error)
          : undefined
      const error = failed?.type === "assistant" ? failed.error : undefined
      return {
        ...(info.outcome ? { outcome: info.outcome } : {}),
        ...(error ? { error } : {}),
        tokens: info.tokens,
        ...(info.model ? { providerID: info.model.providerID } : {}),
      }
    },
    lastText: async (session) =>
      SubagentCompletion.text(
        (await recent(session)).find(
          (message) =>
            message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
        ),
      ),
    diff: (input) =>
      run(sessions.diff({ sessionID: id(input.session), from: input.from as never })).then((files) =>
        files.map((file) => ({ status: file.status, additions: file.additions, deletions: file.deletions })),
      ),
    synthetic: (session, text) =>
      run(
        sessions.synthetic({
          sessionID: id(session),
          text,
          description: BuffLocale.t("Workflow"),
          metadata: { source: "buff-workflow" },
        }),
      ).then(() => undefined),
    interrupt: (session) => run(sessions.interrupt(id(session))).then(() => undefined),
  }
}
