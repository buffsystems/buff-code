export * as BuffBackgroundStop from "./background.js"

import { Effect } from "effect"
import type { Scope } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffBackground } from "@opencode/schema/buff-background"
import { Shell } from "@opencode/schema/shell"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { SessionSchema } from "../session/schema.js"
import { Shell as ShellService } from "../shell.js"

/**
 * Остановка фоновой работы человеком (#456). Команду модели останавливает отмена её задания —
 * процесс завершается вместе с ним, а модель получает «cancelled» без пробуждения
 * (`BuffBackground.afterStop`). Агента — прерывание его сессии и отмена задания. Без задания:
 * сессию агента прерывают, а команду, которую человек запустил сам (`!`), удаляют.
 */

export interface Deps {
  readonly job: (id: string) => Effect.Effect<{ readonly type: string; readonly status: string } | undefined>
  readonly cancel: (id: string) => Effect.Effect<unknown>
  readonly interrupt: (id: string) => Effect.Effect<unknown>
  readonly removeShell: (id: string) => Effect.Effect<unknown>
}

export const stop = Effect.fnUntraced(function* (deps: Deps, id: string) {
  const job = yield* deps.job(id)
  if (!job) {
    // Идентификатор команды начинается с «sh_» (`Shell.ID`), всё прочее — сессия агента.
    yield* id.startsWith("sh_") ? deps.removeShell(id) : deps.interrupt(id)
    return { stopped: true }
  }
  if (job.status !== "running") return { stopped: false }
  if (job.type === "subagent") yield* deps.interrupt(id)
  yield* deps.cancel(id)
  return { stopped: true }
})

export const Plugin = define<Job.Service | Session.Service | ShellService.Service | Scope.Scope>({
  id: "buff.background",
  effect: Effect.fn(function* (ctx) {
    const jobs = yield* Job.Service
    const sessions = yield* Session.Service
    const shells = yield* ShellService.Service
    const deps: Deps = {
      job: (id) => jobs.get(id),
      cancel: (id) => jobs.cancel(id),
      interrupt: (id) => sessions.interrupt(SessionSchema.ID.make(id)),
      removeShell: (id) => shells.remove(Shell.ID.make(id)).pipe(Effect.ignore),
    }
    yield* ctx.rpc.register(BuffBackground.Rpc, { stop: ({ id }) => stop(deps, id) }).pipe(Effect.orDie)
  }),
})
