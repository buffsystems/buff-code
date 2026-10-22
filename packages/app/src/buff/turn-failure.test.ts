// Ошибка хода словами, по которым понятно, что делать (#458). Правила — общие для окна и
// консоли (`@opencode/schema/buff-turn-failure`).
import { expect, test } from "bun:test"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { EMPTY_ANSWER, isEmptyAnswer, turnFailure } from "@opencode/schema/buff-turn-failure"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const buff = (error: { type: string; message: string; status?: number }) => turnFailure(error, "buff", ru)

test("a request with no organisation says to choose the context", () => {
  expect(buff({ type: "provider.auth", message: "not a member of ", status: 403 })).toMatchObject({
    text: "Для этого каталога не выбраны организация и проект Buff. Выберите контекст и повторите.",
    action: "choose-context",
  })
})

test("an organisation one is not a member of is named", () => {
  expect(buff({ type: "provider.auth", message: "not a member of acme", status: 403 })).toMatchObject({
    text: "У вас нет доступа к организации acme. Выберите другую организацию или обратитесь к администратору.",
    action: "choose-context",
  })
})

test("a sign-in that no longer holds offers to sign in again", () => {
  expect(buff({ type: "provider.auth", message: "Устройство отозвано — войдите заново", status: 401 })).toMatchObject({
    text: "Вход в Buff больше не действует: Устройство отозвано — войдите заново",
    action: "sign-in",
  })
})

// #455: бэкенд отказывает кодом 402, когда баланс организации исчерпан.
test("an organisation out of funds says so and offers the cabinet", () => {
  const out = { type: "provider.quota", message: "Недостаточно средств: пополните баланс организации", status: 402 }
  expect(buff(out)).toMatchObject({
    text: "Средства организации закончились. Пополните баланс в кабинете Buff и повторите.",
    action: "top-up",
  })
  expect(turnFailure(out, "openai").action).toBeUndefined()
})

test("a lost connection says what to check", () => {
  expect(buff({ type: "provider.transport", message: "fetch failed" })).toMatchObject({
    text: "Нет связи с коннектором компании. Проверьте сеть и повторите.",
  })
  expect(buff({ type: "provider.transport", message: "fetch failed" }).action).toBeUndefined()
})

test("an error with nothing to read still says something", () => {
  expect(buff({ type: "unknown", message: "" }).text).toBe("Модель не ответила. Повторите запрос.")
  expect(turnFailure({ type: "unknown", message: "" }, "buff").text).toBe("The model did not answer. Repeat the request.")
})

test("any other error reads as it came", () => {
  expect(buff({ type: "provider.internal", message: "upstream timeout", status: 502 }).text).toBe("upstream timeout")
})

// #562: у своего провайдера сразу видно, чья проблема — провайдера, Buff Code или входа в Buff.
const own = (error: { type: string; message: string; status?: number }) =>
  turnFailure(error, "openrouter", ru, "OpenRouter")

test("a key the provider rejects is the provider key, not Buff", () => {
  expect(own({ type: "provider.auth", message: "User not found.", status: 401 })).toMatchObject({
    text:
      "OpenRouter отклонил ключ (ответ 401: User not found). Дело в ключе провайдера, а не в Buff Code и не во входе в Buff Systems. " +
      "Проверьте, что ключ для запросов к моделям (у OpenRouter — API Key, не Management Key), и замените его.",
    action: "replace-key",
  })
  // Слова Buff у чужого провайдера не толкуются.
  expect(own({ type: "provider.auth", message: "not a member of ", status: 403 }).action).toBe("replace-key")
})

test("the provider id stands in for a missing name", () => {
  expect(turnFailure({ type: "provider.auth", message: "bad key", status: 401 }, "litellm", ru).text).toStartWith(
    "litellm отклонил ключ (ответ 401: bad key).",
  )
})

test("each provider failure names the provider and what to do", () => {
  expect(own({ type: "provider.quota", message: "Insufficient credits", status: 402 }).text).toBe(
    "У вашего аккаунта OpenRouter закончились средства или квота (ответ 402: Insufficient credits). Пополните его у провайдера или выберите другую модель.",
  )
  expect(own({ type: "provider.rate-limit", message: "Too many requests", status: 429 }).text).toBe(
    "OpenRouter ограничил частоту запросов (ответ 429: Too many requests). Подождите и повторите.",
  )
  expect(own({ type: "provider.invalid-request", message: "No such model", status: 404 }).text).toBe(
    "OpenRouter не знает эту модель (ответ 404: No such model). Выберите другую модель.",
  )
  expect(own({ type: "provider.transport", message: "fetch failed" }).text).toBe(
    "OpenRouter недоступен: нет связи с его адресом (fetch failed). Проверьте сеть и адрес провайдера.",
  )
  expect(own({ type: "provider.internal", message: "upstream error", status: 502 }).text).toBe(
    "Сбой на стороне OpenRouter (ответ 502: upstream error). Повторите позже.",
  )
  expect(own({ type: "provider.content-filter", message: "flagged" }).text).toBe(
    "OpenRouter отклонил запрос своим фильтром содержимого (flagged).",
  )
  expect(own({ type: "provider.invalid-request", message: "max_tokens too large", status: 400 }).text).toBe(
    "OpenRouter отклонил запрос (ответ 400: max_tokens too large).",
  )
})

test("a model Buff Code cannot reach offers to connect the provider", () => {
  expect(own({ type: "provider.no-route", message: "Model unavailable: openrouter/x" })).toMatchObject({
    text: "Buff Code не может обратиться к модели OpenRouter (Model unavailable: openrouter/x). Подключите провайдера или выберите другую модель.",
    action: "connect-provider",
  })
})

test("a failure that is not the provider's is Buff Code's", () => {
  expect(own({ type: "unknown", message: "boom" }).text).toBe(
    "Ошибка в Buff Code (boom). Скопируйте подробности и передайте в поддержку.",
  )
  expect(own({ type: "unknown", message: "" }).text).toBe("Модель не ответила. Повторите запрос.")
})

test("the details carry everything support would ask for", () => {
  expect(buff({ type: "provider.auth", message: "not a member of acme", status: 403 }).details).toBe(
    "Тип: provider.auth\nКод ответа: 403\nСообщение: not a member of acme",
  )
  expect(buff({ type: "unknown", message: "boom" }).details).toBe("Тип: unknown\nСообщение: boom")
})

test("a finished step with nothing in it is an empty answer", () => {
  const step = { content: [], finish: "stop", time: { created: 1, completed: 2 } }
  expect(isEmptyAnswer(step)).toBe(true)
  expect(buff(EMPTY_ANSWER).text).toBe("Модель не ответила. Повторите запрос.")
})

test("a step with content, an error, tool calls or still running is not an empty answer", () => {
  const step = { content: [], finish: "stop", time: { created: 1, completed: 2 } }
  expect(isEmptyAnswer({ ...step, content: [{ type: "text" }] })).toBe(false)
  expect(isEmptyAnswer({ ...step, error: { type: "unknown", message: "boom" } })).toBe(false)
  expect(isEmptyAnswer({ ...step, finish: "tool-calls" })).toBe(false)
  expect(isEmptyAnswer({ ...step, finish: undefined, time: { created: 1 } })).toBe(false)
})

test("a turn that failed before the model answered points at the usual cause", () => {
  expect(buff({ type: "turn-failed", message: "" })).toMatchObject({
    text: "Запрос не дошёл до модели: она недоступна в этом каталоге. Выберите контекст Buff и модель, затем повторите.",
    action: "choose-context",
  })
})
