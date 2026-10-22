export * as BuffAutomationRunner from "./automation-runner.js"

import { Effect } from "effect"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffLocale } from "./locale.js"
import { BuffSchedule } from "@opencode/schema/buff-schedule"
import type { BuffAutomationStore } from "./automation-store.js"

/**
 * Что делает планировщик автоматизаций (#447) — без службы вокруг: когда запускать, что
 * записать в историю, чем кончился запуск. Сессии, часы и хранилище приходят снаружи
 * (`automation.ts`), поэтому всё здесь проверяется в тестах без службы.
 */

export interface Deps {
  readonly store: BuffAutomationStore.Store
  readonly now: () => number
  /** Новый идентификатор; идентификаторы запусков растут со временем — по ним сортируется история. */
  readonly id: () => string
  /** Начать запуск: новая сессия с задачей. Успех — идентификатор сессии, отказ — причина словами. */
  readonly launch: (automation: BuffAutomation.Automation, run: BuffAutomation.Run) => Effect.Effect<string, string>
  readonly interrupt: (session: string) => Effect.Effect<unknown>
}

export type Change =
  | { readonly type: "succeeded" }
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "interrupted"; readonly reason: "user" | "shutdown" | "superseded" | "inactivity" }
  | { readonly type: "asked" }
  | { readonly type: "replied" }

type Saved = { readonly automation?: BuffAutomation.Automation; readonly problem?: string }

/** Отказ службы — по-английски; окно и консоль переводят его на язык человека. */
const NOT_FOUND = "The automation was not found — it was already deleted."
const date = (ms: number) => new Date(ms)
const nextAfter = (automation: Pick<BuffAutomation.Automation, "schedule" | "anchor">, after: number) =>
  BuffSchedule.next(automation.schedule, date(automation.anchor), date(after)).getTime()
const going = (run: BuffAutomation.Run | undefined) => run?.status === "running" || run?.status === "waiting"

export const save = Effect.fnUntraced(function* (deps: Deps, id: string | undefined, draft: BuffAutomation.Draft) {
  const problem = BuffAutomation.draftProblem(draft, BuffLocale.t)
  if (problem) return { problem } satisfies Saved
  const now = deps.now()
  const existing = id === undefined ? undefined : yield* deps.store.get(id)
  if (id !== undefined && !existing) return { problem: NOT_FOUND } satisfies Saved
  const rescheduled = !existing || JSON.stringify(existing.schedule) !== JSON.stringify(draft.schedule)
  const base = existing ?? { id: deps.id(), paused: false, created: now, anchor: now, next: now, count: 0 }
  const anchor = rescheduled ? now : base.anchor
  const automation: BuffAutomation.Automation = {
    ...base,
    ...draft,
    anchor,
    next: rescheduled ? nextAfter({ schedule: draft.schedule, anchor }, now) : base.next,
  }
  yield* deps.store.put(automation)
  return { automation } satisfies Saved
})

export const pause = Effect.fnUntraced(function* (deps: Deps, id: string, paused: boolean) {
  const automation = yield* deps.store.get(id)
  if (!automation) return { problem: NOT_FOUND } satisfies Saved
  // Снятая с паузы не догоняет сроки паузы: следующий — от «сейчас».
  const next = paused ? automation.next : nextAfter(automation, deps.now())
  const updated = { ...automation, paused, next }
  yield* deps.store.put(updated)
  return { automation: updated } satisfies Saved
})

const start = Effect.fnUntraced(function* (
  deps: Deps,
  automation: BuffAutomation.Automation,
  input: Pick<BuffAutomation.Run, "due" | "source" | "late">,
) {
  const queued: BuffAutomation.Run = {
    id: deps.id(),
    automation: automation.id,
    started: deps.now(),
    status: "running",
    ...input,
  }
  yield* deps.store.put({ ...automation, count: automation.count + 1 })
  const run = yield* deps.launch(automation, queued).pipe(
    Effect.map((session): BuffAutomation.Run => ({ ...queued, session })),
    Effect.catch((error) =>
      Effect.succeed<BuffAutomation.Run>({ ...queued, status: "failed", error, finished: deps.now() }),
    ),
  )
  yield* deps.store.putRun(run)
  return run
})

const skip = (deps: Deps, automation: BuffAutomation.Automation, due: number, skipped: number, reason?: string) =>
  deps.store.putRun({
    id: deps.id(),
    automation: automation.id,
    due,
    started: deps.now(),
    finished: deps.now(),
    status: "skipped",
    source: "schedule",
    skipped,
    ...(reason ? { reason } : {}),
  })

/** Наступившие сроки: один запуск за последний срок, пропущенные — одной строкой истории. */
export const tick = Effect.fnUntraced(function* (deps: Deps) {
  const now = deps.now()
  for (const automation of yield* deps.store.list()) {
    if (automation.paused) continue
    const due = BuffSchedule.due(automation.schedule, date(automation.anchor), date(automation.next), date(now))
    if (!due) continue
    const at = due.at.getTime()
    const planned = { ...automation, next: nextAfter(automation, at) }
    yield* deps.store.put(planned)
    if (going(automation.last)) {
      yield* skip(deps, planned, at, due.skipped + 1, BuffAutomation.BUSY)
      continue
    }
    if (due.skipped > 0) yield* skip(deps, planned, at, due.skipped)
    yield* start(deps, planned, { due: at, source: "schedule", late: due.late })
  }
})

export const runNow = Effect.fnUntraced(function* (deps: Deps, id: string) {
  const automation = yield* deps.store.get(id)
  if (!automation) return { problem: NOT_FOUND }
  if (going(automation.last)) return { problem: BuffAutomation.ALREADY_RUNNING }
  return { run: yield* start(deps, automation, { due: deps.now(), source: "manual" }) }
})

const finish = (deps: Deps, run: BuffAutomation.Run, status: BuffAutomation.RunStatus, error?: string) =>
  deps.store.putRun({ ...run, status, finished: deps.now(), ...(error ? { error } : {}) })

export const stop = Effect.fnUntraced(function* (deps: Deps, id: string) {
  const run = (yield* deps.store.get(id))?.last
  if (!run || !going(run)) return { stopped: false }
  if (run.session) yield* deps.interrupt(run.session)
  yield* finish(deps, run, "stopped")
  return { stopped: true }
})

/** Событие сессии запуска → статус запуска. Завершённый запуск поздние события не переписывают. */
export const settle = Effect.fnUntraced(function* (deps: Deps, session: string, change: Change) {
  const run = (yield* deps.store.list()).map((automation) => automation.last).find((last) => last?.session === session)
  if (!run || !going(run)) return
  switch (change.type) {
    case "succeeded":
      return yield* finish(deps, run, "succeeded")
    case "failed":
      return yield* finish(deps, run, "failed", change.error)
    case "asked":
      return yield* deps.store.putRun({ ...run, status: "waiting" })
    case "replied":
      return yield* deps.store.putRun({ ...run, status: "running" })
    case "interrupted":
      if (change.reason === "user") return yield* finish(deps, run, "stopped")
      if (change.reason === "inactivity") {
        const error = run.status === "waiting" ? BuffAutomation.INACTIVE_WAITING : BuffAutomation.INACTIVE
        return yield* finish(deps, run, "failed", error)
      }
      // Перезапуск службы возобновит сессию, а «superseded» — её продолжение: запуск ещё идёт.
      return
  }
})
