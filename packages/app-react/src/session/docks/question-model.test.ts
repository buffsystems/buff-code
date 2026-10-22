import { expect, test } from "bun:test"
import type { FormInfo } from "@opencode/client/promise"
import { answered, emptyQuestionState, formAnswer, pick, questionsOf, setCustom, setCustomOn, toggle } from "./question-model"

const form = {
  id: "frm",
  sessionID: "ses",
  fields: [
    { key: "q0", type: "string", title: "One", options: [{ value: "a", label: "A" }], custom: true },
    { key: "q1", type: "multiselect", title: "Many", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
  ],
} as unknown as FormInfo

test("a single answer, several answers and an own answer make the form's answer", () => {
  const questions = questionsOf(form)
  const first = pick(emptyQuestionState(), "a")
  const second = toggle(toggle({ ...first, tab: 1 }, "x"), "y")
  expect(formAnswer(questions, second)).toEqual({ q0: "a", q1: ["x", "y"] })
  const custom = setCustom(setCustomOn({ ...second, tab: 0 }, true), "mine", false)
  expect(formAnswer(questions, custom).q0).toBe("mine")
  expect(answered(custom, 0)).toBe(true)
})

test("an own answer in a multi-question replaces its previous text, not the picked options", () => {
  const state = setCustomOn({ ...toggle({ ...emptyQuestionState(), tab: 1 }, "x") }, true)
  const typed = setCustom(setCustom(state, "fir", true), "first", true)
  expect(typed.answers[1]).toEqual(["x", "first"])
})
