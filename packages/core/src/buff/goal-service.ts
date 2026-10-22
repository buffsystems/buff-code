export * as BuffGoalService from "./goal-service.js"

import { Context, Effect, Layer, Schema, Stream } from "effect"
import type { Scope } from "effect"
import { BuffGoal } from "@opencode/schema/buff-goal"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { KV } from "../kv.js"
import { Session } from "../session.js"
import { SessionEvent } from "../session/event.js"
import { SessionSchema } from "../session/schema.js"
import { GoalRunner } from "./goal/runner.js"
import { BuffLocale } from "./locale.js"

/**
 * Служба целей сессий (#463) — одна на процесс: цель в KV, ходы сессий — по событиям
 * исполнения, проверка — ответом модели по контексту сессии. Окно и консоль говорят с ней
 * через плагин каталога (`goal.ts`), он же получает изменения, чтобы разослать их.
 */

const key = (session: string) => `buff.goal:${session}`
const decode = (value: unknown) => {
  const decoded = Schema.decodeUnknownOption(BuffGoal.Goal)(value)
  return decoded._tag === "Some" ? decoded.value : undefined
}
const make = Effect.gen(function* () {
  const kv = yield* KV.Service
  const sessions = yield* Session.Service
  const bus = yield* Bus.Service
  const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect as Effect.Effect<A>)
  const id = (session: string) => SessionSchema.ID.make(session)
  const listeners = new Set<(session: string, goal: BuffGoal.Goal | undefined) => void>()
  const directories = new Map<string, string>()

  const runner = GoalRunner.make({
    store: {
      get: (session) => run(kv.get(key(session))).then(decode),
      put: (session, goal) => run(kv.set(key(session), JSON.parse(JSON.stringify(goal)))),
      remove: (session) => run(kv.remove(key(session))).then(() => undefined),
    },
    // Служебная отметка «Цель», а не сообщение человека: будит модель, человек видит её свёрнутой.
    prompt: (session, text) =>
      run(
        sessions.synthetic({
          sessionID: id(session),
          text,
          description: BuffLocale.t("Goal"),
          metadata: { source: "buff-goal" },
        }),
      ).then(() => undefined),
    generate: (session, prompt) => run(sessions.generate({ sessionID: id(session), prompt })),
    announce: (session, text) =>
      run(
        sessions.synthetic({
          sessionID: id(session),
          text,
          description: BuffLocale.t("Goal"),
          metadata: { source: "buff-goal", summary: text },
          resume: false,
        }),
      ).then(() => undefined),
    idle: (session) => run(sessions.active).then((active) => !active.has(id(session))),
    changed: (session, goal) => listeners.forEach((listener) => listener(session, goal)),
    directory: (session) => directories.get(session) ?? "",
    now: () => Date.now(),
  })
  const remember = (session: string) =>
    run(sessions.get(id(session))).then(
      (info) => void directories.set(session, info.location.directory),
      () => undefined,
    )

  const watch = bus
    .subscribe([SessionEvent.Execution.Succeeded, SessionEvent.Execution.Failed, SessionEvent.Execution.Interrupted])
    .pipe(
      Stream.runForEach((event) =>
        Effect.promise(async () => {
          const session = event.data.sessionID
          await remember(session)
          const outcome =
            event.type === "session.execution.succeeded"
              ? "succeeded"
              : event.type === "session.execution.failed"
                ? "failed"
                : "interrupted"
          const reason =
            event.type === "session.execution.failed"
              ? BuffLocale.t("The turn stopped with an error: {message}", { message: event.data.error.message })
              : undefined
          await runner.turn(session, outcome, reason).catch(() => undefined)
        }),
      ),
    )

  /** Сессия, начатая с `/goal`, без названия — называется целью, чтобы её было видно в списке. */
  const name = (session: string, text: string) =>
    run(sessions.get(id(session))).then(
      (info) => (info.title ? undefined : run(sessions.rename({ sessionID: id(session), title: BuffLocale.t("Goal: {text}", { text }) }))),
      () => undefined,
    )

  return {
    runner,
    remember,
    name,
    listen: (listener: (session: string, goal: BuffGoal.Goal | undefined) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    watch,
  }
})

export type Interface = Omit<Effect.Success<typeof make>, "watch"> & {
  /** Слушать ходы сессий — только в управляемой службе (одна на машину). */
  readonly start: Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@buff/GoalService") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { watch, ...service } = yield* make
    return Service.of({ ...service, start: Effect.forkScoped(watch).pipe(Effect.asVoid) })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Session.node, Bus.node] })
