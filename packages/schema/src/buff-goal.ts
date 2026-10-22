export * as BuffGoal from "./buff-goal.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Цель сессии (#463), как в ZCode: `/goal <текст>` — агент работает итерациями; после каждого
 * хода отдельный проверяющий решает, достигнута ли цель; нет — следующий ход сам, да — конец.
 * Человек ставит на паузу, продолжает, сбрасывает. Лимита итераций нет — останавливает человек.
 * Здесь — запись цели, её переходы (без ввода-вывода), слова и RPC.
 */

export const Status = Schema.Literals(["active", "checking", "paused", "complete"])
export type Status = typeof Status.Type

export const Goal = Schema.Struct({
  text: Schema.String,
  status: Status,
  iteration: Schema.Number,
  /** Почему проверяющий не засчитал цель, почему пауза или чем она достигнута. */
  reason: Schema.optional(Schema.String),
  started: Schema.Number,
  updated: Schema.Number,
  finished: Schema.optional(Schema.Number),
})
export type Goal = typeof Goal.Type

export type Event =
  | { readonly type: "set"; readonly text: string }
  | { readonly type: "turn"; readonly outcome: "succeeded" | "failed" | "interrupted"; readonly reason?: string }
  | { readonly type: "verdict"; readonly complete: boolean; readonly reason: string }
  | { readonly type: "pause"; readonly reason?: string }
  | { readonly type: "resume"; readonly idle: boolean }
  | { readonly type: "clear" }

/** start — первый ход по цели; check — запустить проверяющего; continue — следующий ход; done — объявить. */
export type Action = "start" | "check" | "continue" | "done"
export type Step = { readonly goal?: Goal; readonly action?: Action }

/** Причина паузы хранится английской строкой — экран переводит её (#472). */
export const INTERRUPTED = "The turn stopped — the goal is paused."

export function next(goal: Goal | undefined, event: Event, now: number): Step {
  if (event.type === "set")
    return { goal: { text: event.text, status: "active", iteration: 1, started: now, updated: now }, action: "start" }
  if (!goal) return {}
  if (event.type === "clear") return {}
  const at = (patch: Partial<Goal>): Goal => ({ ...goal, ...patch, updated: now })
  switch (event.type) {
    case "pause":
      if (goal.status === "complete") return { goal }
      return { goal: at({ status: "paused", ...(event.reason ? { reason: event.reason } : {}) }) }
    case "resume":
      if (goal.status !== "paused") return { goal }
      return event.idle
        ? { goal: at({ status: "active", iteration: goal.iteration + 1 }), action: "continue" }
        : { goal: at({ status: "active" }) }
    case "turn":
      if (goal.status !== "active") return { goal }
      if (event.outcome === "succeeded") return { goal: at({ status: "checking" }), action: "check" }
      return { goal: at({ status: "paused", reason: event.reason ?? INTERRUPTED }) }
    case "verdict":
      if (goal.status === "paused" && !event.complete) return { goal: { ...goal, reason: event.reason } }
      if (goal.status !== "checking" && goal.status !== "paused") return { goal }
      return event.complete
        ? { goal: at({ status: "complete", reason: event.reason, finished: now }), action: "done" }
        : { goal: at({ status: "active", iteration: goal.iteration + 1, reason: event.reason }), action: "continue" }
  }
}

export const STATUS_LABEL: Record<Status, string> = {
  active: "In progress",
  checking: "Checking",
  paused: "Paused",
  complete: "Achieved",
}

export function line(goal: Goal, t: BuffI18n.T = BuffI18n.english): string {
  return t("Goal · iteration {iteration} · {status}: {text}", {
    iteration: goal.iteration,
    status: t(STATUS_LABEL[goal.status]),
    text: goal.text,
  })
}

export const USAGE = "Write the goal after the command: /goal <what to achieve>."

export function parse(
  text: string,
  t: BuffI18n.T = BuffI18n.english,
): { readonly text: string } | { readonly problem: string } {
  const trimmed = text.trim()
  return trimmed ? { text: trimmed } : { problem: t(USAGE) }
}

const Session = Schema.Struct({ session: Schema.String })
const portable = Schema.toStandardSchemaV1

export const Rpc = define({
  id: "buff.goal",
  methods: {
    get: { input: portable(Session), output: portable(Schema.Struct({ goal: Schema.optional(Goal) })) },
    pause: { input: portable(Session), output: portable(Schema.Struct({ goal: Schema.optional(Goal) })) },
    resume: { input: portable(Session), output: portable(Schema.Struct({ goal: Schema.optional(Goal) })) },
    clear: { input: portable(Session), output: portable(Schema.Struct({})) },
  },
  events: {
    changed: { schema: portable(Schema.Struct({ session: Schema.String, goal: Schema.optional(Goal) })) },
  },
})
