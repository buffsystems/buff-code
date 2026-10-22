export * as BuffGoalPlugin from "./goal.js"

import { Effect } from "effect"
import type { Scope } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffGoal } from "@opencode/schema/buff-goal"
import { BuffGoalService } from "./goal-service.js"
import { BuffLocale } from "./locale.js"

/**
 * Цель сессии в каталоге (#463): команда `/goal <текст>`, RPC для окна и консоли — цель,
 * пауза, продолжить, сбросить — и событие об изменении. Ходы и проверку ведёт служба процесса.
 */

export const Plugin = define<BuffGoalService.Service | Scope.Scope>({
  id: "buff.goal",
  effect: Effect.fn(function* (ctx) {
    const goals = yield* BuffGoalService.Service
    const call = <A>(body: () => Promise<A>) => Effect.promise(body)

    const registration = yield* ctx.rpc
      .register(BuffGoal.Rpc, {
        get: ({ session }) => call(() => goals.runner.get(session)).pipe(Effect.map((goal) => (goal ? { goal } : {}))),
        pause: ({ session }) =>
          call(() => goals.runner.pause(session)).pipe(Effect.map(({ goal }) => (goal ? { goal } : {}))),
        resume: ({ session }) =>
          call(() => goals.runner.resume(session)).pipe(Effect.map(({ goal }) => (goal ? { goal } : {}))),
        clear: ({ session }) => call(() => goals.runner.clear(session)).pipe(Effect.as({})),
      })
      .pipe(Effect.orDie)
    const stop = goals.listen((session, goal) => {
      Effect.runFork(registration.events.emit("changed", { session, ...(goal ? { goal } : {}) }).pipe(Effect.ignore))
    })
    yield* Effect.addFinalizer(() => Effect.sync(stop))

    yield* ctx.command
      .transform((editor) =>
        editor.add({
          name: "goal",
          description: BuffLocale.t("Session goal: the agent works in iterations until the check accepts the goal"),
          execute: (input) =>
            Effect.promise(async () => {
              await goals.remember(input.sessionID)
              const done = await goals.runner.set(input.sessionID, input.prompt.text)
              if (done.problem) throw new Error(done.problem)
              await goals.name(input.sessionID, input.prompt.text.trim())
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
})
