// Причина отказа в консоли (#458): служба отвечает объектом, а не Error — его слова нельзя терять.
import { expect, test } from "bun:test"
import { failureMessage } from "@opencode/schema/buff-failure"

const FALLBACK = "Вход не удался"

test("the service's refusal reads as its message", () => {
  const refused = { _tag: "InvalidRequestError", kind: "integration_authorization", message: "Коннектор не отвечает." }
  expect(failureMessage(refused, FALLBACK)).toBe("Коннектор не отвечает.")
})

test("a refusal wrapped by the client is unwrapped", () => {
  const wrapped = new Error("Request failed", { cause: { body: { message: "Вход отклонили в кабинете." } } })
  expect(failureMessage(wrapped, FALLBACK)).toBe("Вход отклонили в кабинете.")
})

test("a plain error reads as itself", () => {
  expect(failureMessage(new Error("сеть недоступна"), FALLBACK)).toBe("сеть недоступна")
})

test("nothing to read falls back to the general wording", () => {
  for (const cause of [undefined, null, {}, { message: "" }, 42]) expect(failureMessage(cause, FALLBACK)).toBe(FALLBACK)
})
