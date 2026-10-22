// The question dock's answers (#584): a pure port of the Solid question dock's store — the tab,
// picked options, a typed own answer per question — and the answer it submits.

import type { FormAnswer, FormInfo, FormMultiselectField, FormStringField } from "@opencode/client/promise"

type QuestionField = FormStringField | FormMultiselectField

export type Question = {
  field: QuestionField
  question: string
  options: { value: string; label: string; description?: string }[]
  multiple: boolean
}

export type QuestionState = { tab: number; answers: string[][]; custom: string[]; customOn: boolean[] }

export const emptyQuestionState = (): QuestionState => ({ tab: 0, answers: [], custom: [], customOn: [] })

export function questionsOf(form: FormInfo): Question[] {
  return form.fields
    .filter((field): field is QuestionField => field.type === "string" || field.type === "multiselect")
    .map((field) => ({
      field,
      question: field.description ?? field.title ?? "",
      options: field.type === "string" ? (field.options ?? []) : field.options,
      multiple: field.type === "multiselect",
    }))
}

const at = <Value>(list: Value[], index: number, value: Value) => {
  const next = [...list]
  next[index] = value
  return next
}

/** Pick a single answer: the option replaces the custom one. */
export function pick(state: QuestionState, value: string): QuestionState {
  return { ...state, answers: at(state.answers, state.tab, [value]), customOn: at(state.customOn, state.tab, false) }
}

export function toggle(state: QuestionState, value: string): QuestionState {
  const current = state.answers[state.tab] ?? []
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
  return { ...state, answers: at(state.answers, state.tab, next) }
}

/** Type the own answer; while it is on it is (one of) the answers. */
export function setCustom(state: QuestionState, value: string, multiple: boolean, selected = state.customOn[state.tab] === true): QuestionState {
  const previous = (state.custom[state.tab] ?? "").trim()
  const trimmed = value.trim()
  const custom = at(state.custom, state.tab, value)
  if (!selected) return { ...state, custom }
  if (!multiple) return { ...state, custom, answers: at(state.answers, state.tab, trimmed ? [trimmed] : []) }
  const current = state.answers[state.tab] ?? []
  const removed = previous ? current.filter((item) => item.trim() !== previous) : current
  const answers = !trimmed || removed.some((item) => item.trim() === trimmed) ? removed : [...removed, trimmed]
  return { ...state, custom, answers: at(state.answers, state.tab, answers) }
}

export function setCustomOn(state: QuestionState, on: boolean): QuestionState {
  return { ...state, customOn: at(state.customOn, state.tab, on) }
}

export function answered(state: QuestionState, index: number) {
  if ((state.answers[index]?.length ?? 0) > 0) return true
  return state.customOn[index] === true && (state.custom[index] ?? "").trim().length > 0
}

export function formAnswer(questions: Question[], state: QuestionState): FormAnswer {
  return Object.fromEntries(
    questions.flatMap((question, index) => {
      const answers = state.answers[index] ?? []
      if (answers.length === 0) return []
      return [[question.field.key, question.multiple ? answers : answers[0]]]
    }),
  )
}
