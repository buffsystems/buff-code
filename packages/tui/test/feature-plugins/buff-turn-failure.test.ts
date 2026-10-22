// Ошибка хода в консоли (#458): та же причина словами, что и в окне, и чем её исправить здесь.
import { expect, test } from "bun:test"
import { consoleTurnFailure, failedBeforeAnswer, keyFailure, settleKeyFailure } from "../../src/feature-plugins/buff/turn-failure"

test("a request with no organisation says which command chooses the context", () => {
  expect(consoleTurnFailure({ type: "provider.auth", message: "not a member of ", status: 403 }, "buff")).toEqual({
    text: "Для этого каталога не выбраны организация и проект Buff. Выберите контекст и повторите.",
    hint: "/org — выбрать организацию и проект · ↑ — вернуть сообщение в поле ввода",
  })
})

test("a sign-in that no longer holds says how to sign in again", () => {
  expect(
    consoleTurnFailure({ type: "provider.auth", message: "Устройство отозвано — войдите заново", status: 401 }, "buff")
      .hint,
  ).toBe("/connect — войти заново · ↑ — вернуть сообщение в поле ввода")
})

test("any other failure offers to send the message again", () => {
  expect(consoleTurnFailure({ type: "provider.internal", message: "upstream timeout", status: 502 }, "buff")).toEqual({
    text: "upstream timeout",
    hint: "↑ — вернуть сообщение в поле ввода",
  })
})

// #562: отказ своего провайдера — его имя, чья проблема и команда, которой меняют ключ.
test("a key the own provider rejects says how to replace it", () => {
  const failure = consoleTurnFailure({ type: "provider.auth", message: "User not found.", status: 401 }, "openrouter", "OpenRouter")
  expect(failure.text).toStartWith("OpenRouter отклонил ключ (ответ 401: User not found).")
  expect(failure.hint).toBe("/connect — заменить ключ провайдера · ↑ — вернуть сообщение в поле ввода")
  expect(consoleTurnFailure({ type: "provider.no-route", message: "Model unavailable" }, "litellm").hint).toBe(
    "/connect — подключить провайдера · ↑ — вернуть сообщение в поле ввода",
  )
})

// Ход, упавший до первого шага модели: под сообщением человека раньше не было ничего.
const user = (id: string) => ({ id, type: "user" as const })
const idle = (outcome: string) => ({ id: "idle", type: "idle" as const, outcome })

test("a message whose turn failed before any answer is marked", () => {
  expect(failedBeforeAnswer([user("a"), idle("failed")], "a")).toBe(true)
  // Служебные отметки между сообщением и неудачей не в счёт.
  expect(failedBeforeAnswer([user("a"), { id: "n", type: "system" }, idle("failed")], "a")).toBe(true)
})

test("an answered, finished, interrupted or still running turn is not", () => {
  expect(failedBeforeAnswer([user("a"), { id: "b", type: "assistant" }, idle("failed")], "a")).toBe(false)
  expect(failedBeforeAnswer([user("a"), idle("succeeded")], "a")).toBe(false)
  expect(failedBeforeAnswer([user("a"), idle("interrupted")], "a")).toBe(false)
  expect(failedBeforeAnswer([user("a")], "a")).toBe(false)
  expect(failedBeforeAnswer([user("a"), user("b"), idle("failed")], "a")).toBe(false)
})

// #562: /connect после отказа ключа открывает сразу того провайдера, чей ключ отклонён.
test("the provider whose key the last turn was refused on is found", () => {
  const assistant = (providerID: string, error?: { type: string; message: string; status?: number }, id = "msg_a") => ({
    id,
    type: "assistant" as const,
    model: { providerID, id: "m" },
    ...(error ? { error } : {}),
  })
  const refused = { type: "provider.auth", message: "User not found.", status: 401 }
  expect(keyFailure([assistant("openrouter", refused)])).toEqual({ providerID: "openrouter", rejected: true, messageID: "msg_a" })
  expect(keyFailure([assistant("litellm", { type: "provider.no-route", message: "x" })])).toEqual({
    providerID: "litellm",
    rejected: false,
    messageID: "msg_a",
  })
  // Новый ключ уже добавлен в ответ на этот отказ — он больше не помечает запись.
  settleKeyFailure("msg_settled")
  expect(keyFailure([assistant("openrouter", refused, "msg_settled")])).toBeUndefined()
  // Последний ход прошёл — чинить нечего; отказ Buff чинится входом, а не ключом.
  expect(keyFailure([assistant("openrouter", refused), { id: "u", type: "user" }, assistant("openrouter")])).toBeUndefined()
  expect(keyFailure([assistant("buff", refused)])).toBeUndefined()
  expect(keyFailure([])).toBeUndefined()
})
