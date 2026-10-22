export * as GoalRunner from "./runner.js"

import { BuffGoal } from "@opencode/schema/buff-goal"
import checkText from "./prompts/check.md" with { type: "text" }
import checkRetryText from "./prompts/check-retry.md" with { type: "text" }
import continueText from "./prompts/continue.md" with { type: "text" }
import startText from "./prompts/start.md" with { type: "text" }
import { BuffLocale } from "../locale.js"

/**
 * Цель сессии (#463) без службы: переходы — в схеме (`BuffGoal.next`), здесь — их действия:
 * первый ход, проверка ответом модели по контексту сессии (без записи в историю), следующий
 * ход с причиной, объявление. Нечитаемый ответ проверки — пауза с причиной, а не цикл.
 */

export interface Deps {
  readonly store: {
    readonly get: (session: string) => Promise<BuffGoal.Goal | undefined>
    readonly put: (session: string, goal: BuffGoal.Goal) => Promise<void>
    readonly remove: (session: string) => Promise<void>
  }
  /** Указание модели в сессии — будит её. */
  readonly prompt: (session: string, text: string) => Promise<void>
  /** Ответ модели по контексту сессии, без записи в историю. */
  readonly generate: (session: string, prompt: string) => Promise<string>
  /** Отметка в сессии, не будит модель. */
  readonly announce: (session: string, text: string) => Promise<void>
  readonly idle: (session: string) => Promise<boolean>
  readonly changed: (session: string, goal: BuffGoal.Goal | undefined) => void
  readonly directory: (session: string) => string
  readonly now: () => number
}

const render = (template: string, values: Record<string, string>) =>
  template.trim().replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "")

// Причина паузы видит человек (строка цели) — на его языке.
const UNREADABLE = (answer: string) =>
  BuffLocale.t("The goal check reached no decision — the goal is paused; resume when ready. The check answered: {answer}", {
    answer,
  })
const FAILED = (cause: string) =>
  BuffLocale.t("The goal check failed — the goal is paused; resume when ready. Reason: {cause}", { cause })
const words = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function verdict(text: string): { readonly complete: boolean; readonly reason: string } | undefined {
  const match = /\{[\s\S]*\}/.exec(text)
  if (!match) return undefined
  try {
    const value = JSON.parse(match[0]) as { complete?: unknown; reason?: unknown }
    if (typeof value.complete !== "boolean") return undefined
    return { complete: value.complete, reason: typeof value.reason === "string" ? value.reason : "" }
  } catch {
    return undefined
  }
}

export function make(deps: Deps) {
  const apply = async (session: string, event: BuffGoal.Event): Promise<BuffGoal.Goal | undefined> => {
    const step = BuffGoal.next(await deps.store.get(session), event, deps.now())
    if (step.goal) await deps.store.put(session, step.goal)
    else await deps.store.remove(session)
    deps.changed(session, step.goal)
    if (step.goal && step.action) await act(session, step.goal, step.action)
    return step.goal
  }
  const act = async (session: string, goal: BuffGoal.Goal, action: BuffGoal.Action) => {
    const values = {
      goal: goal.text,
      iteration: String(goal.iteration),
      reason: goal.reason ?? "",
      directory: deps.directory(session),
    }
    if (action === "start") return deps.prompt(session, render(startText, values))
    if (action === "continue") return deps.prompt(session, render(continueText, values))
    if (action === "done") return deps.announce(session, BuffLocale.t("Goal reached: {reason}", { reason: values.reason }))
    // Нечитаемый ответ бывает сбоем формата: спросить ещё раз; снова нечитаемый — пауза с ответом.
    const check = render(checkText, values)
    const outcome = await deps
      .generate(session, check)
      .then((first) =>
        verdict(first) ? first : deps.generate(session, `${check}\n\n${render(checkRetryText, values)}`),
      )
      .then(
        (answer) => ({ answer }),
        (error: unknown) => ({ error: words(error) }),
      )
    if ("error" in outcome) return void (await apply(session, { type: "pause", reason: FAILED(outcome.error) }))
    const decided = verdict(outcome.answer)
    await apply(
      session,
      decided
        ? { type: "verdict", complete: decided.complete, reason: decided.reason }
        : { type: "pause", reason: UNREADABLE(outcome.answer.trim()) },
    )
  }

  return {
    get: (session: string) => deps.store.get(session),
    set: async (session: string, text: string): Promise<{ readonly problem?: string }> => {
      const parsed = BuffGoal.parse(text, BuffLocale.t)
      if ("problem" in parsed) return { problem: parsed.problem }
      await apply(session, { type: "set", text: parsed.text })
      return {}
    },
    /** Ход сессии кончился; сессии без цели не трогаются. */
    turn: async (session: string, outcome: "succeeded" | "failed" | "interrupted", reason?: string) => {
      if (!(await deps.store.get(session))) return
      await apply(session, { type: "turn", outcome, ...(reason ? { reason } : {}) })
    },
    pause: async (session: string) => ({ goal: await apply(session, { type: "pause" }) }),
    resume: async (session: string) => ({
      goal: await apply(session, { type: "resume", idle: await deps.idle(session) }),
    }),
    clear: async (session: string) => void (await apply(session, { type: "clear" })),
  }
}
