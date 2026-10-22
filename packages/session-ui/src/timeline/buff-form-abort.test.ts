// Вопрос или план без ответа (#470): закрыли форму или Buff Code закрылся, пока она ждала. Окно
// рисовало красную карточку ошибки «plan_exit The user dismissed the plan.» / «Interaction
// cancelled because the location shut down» — по-английски и как сбой.
import { expect, test } from "bun:test"
import { formAbortNote } from "./buff-form-abort"

test("закрыли форму — «Вопросы отклонены» / «План закрыт без ответа»", () => {
  expect(formAbortNote("question", "Error: The user dismissed this question")).toBe("Questions dismissed")
  expect(formAbortNote("plan_exit", "The user dismissed this question")).toBe("Plan closed without an answer")
})

test("Buff Code закрылся, пока форма ждала, — «прервано», а не ошибка", () => {
  const shut = "Interaction cancelled because the location shut down"
  expect(formAbortNote("question", shut)).toBe("Interrupted: Buff Code was closed")
  expect(formAbortNote("plan_exit", shut)).toBe("Interrupted: Buff Code was closed")
})

test("другие инструменты и настоящие ошибки — карточкой, как раньше", () => {
  expect(formAbortNote("read", "Interaction cancelled because the location shut down")).toBeUndefined()
  expect(formAbortNote("plan_exit", "plan_exit is only for Plan mode.")).toBeUndefined()
})
