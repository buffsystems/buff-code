export * as BuffPlan from "./buff-plan.js"

import { BuffI18n } from "./buff-i18n.js"

/**
 * План (#463), как в ZCode: в режиме «План» агент отдаёт готовый план инструментом `plan_exit`,
 * человек видит карточку плана и отвечает — «Утвердить и начать» или своё замечание. Здесь —
 * форма ответа, разбор решения и слова карточки; одинаково для окна, консоли и ядра.
 */

export const TOOL = "plan_exit"
export const FIELD = "q0"
export const APPROVE = "approve"

/** Форма ответа на план; её задаёт ядро — на языке человека (`t`). */
export function fields(t: BuffI18n.T = BuffI18n.english) {
  return [
    {
      key: FIELD,
      title: t("Plan"),
      description: t("Approve the plan and start working? Or write what to change."),
      type: "string" as const,
      options: [
        {
          value: APPROVE,
          label: t("Approve and start"),
          description: t("Plan mode turns off and the agent gets to work"),
        },
      ],
      custom: true,
    },
  ] as const
}

export type Decision = { readonly approved: true } | { readonly approved: false; readonly note: string }

export function decision(answer: Readonly<Record<string, unknown>>): Decision {
  const value = answer[FIELD]
  if (value === APPROVE) return { approved: true }
  return { approved: false, note: typeof value === "string" ? value.trim() : "" }
}

/** Решение из метаданных вызова `plan_exit`; ещё не принято — ничего. */
export function decisionOf(metadata: Readonly<Record<string, unknown>> | undefined): Decision | undefined {
  const value = metadata?.decision
  if (typeof value !== "object" || value === null || !("approved" in value)) return undefined
  if (value.approved === true) return { approved: true }
  const note = "note" in value && typeof value.note === "string" ? value.note : ""
  return { approved: false, note }
}

/** Слова карточки плана по решению из метаданных вызова и его состоянию. */
export function state(decided: Decision | undefined, status: string, t: BuffI18n.T = BuffI18n.english): string {
  if (decided?.approved) return t("Approved")
  if (decided) return decided.note ? t("Being revised: {note}", { note: decided.note }) : t("Being revised")
  if (status === "error") return t("Not approved")
  return t("Waiting for approval")
}
