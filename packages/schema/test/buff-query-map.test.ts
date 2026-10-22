// Карта запросов (#465): запросы сессии по порядку — текст, начало ответа, идёт ли ответ.
import { expect, test } from "bun:test"
import { BuffQueryMap } from "../src/buff-query-map.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const user = (id: string, text: string) => ({ id, type: "user", text })
const assistant = (id: string, text: string, completed = true) => ({
  id,
  type: "assistant",
  content: [
    { type: "reasoning", text: "думаю" },
    { type: "text", text },
  ],
  time: completed ? { created: 1, completed: 2 } : { created: 1 },
})

test("each query with the start of its answer", () => {
  expect(
    BuffQueryMap.queries([
      user("u1", "Первый"),
      assistant("a1", "Ответ один"),
      assistant("a2", "и продолжение"),
      { id: "s", type: "synthetic", text: "служебное" },
      user("u2", "Второй"),
      assistant("a3", "", false),
    ]),
  ).toEqual([
    { id: "u1", index: 1, text: "Первый", answer: "Ответ один\nи продолжение", running: false },
    { id: "u2", index: 2, text: "Второй", answer: "", running: true },
  ])
})

test("shown for two queries and more", () => {
  expect(BuffQueryMap.shown([user("u1", "a")])).toBe(false)
  expect(BuffQueryMap.shown([user("u1", "a"), user("u2", "b")])).toBe(true)
})

test("preview words", () => {
  expect(BuffQueryMap.preview({ id: "u", index: 3, text: "", answer: "", running: true }, ru)).toEqual({
    title: "Запрос 3",
    query: "Запрос без текста",
    answer: "Ответ ещё идёт",
  })
  expect(BuffQueryMap.preview({ id: "u", index: 1, text: "Что?", answer: "", running: false }, ru).answer).toBe(
    "Ответа пока нет",
  )
})

test("preview words — English by default", () => {
  expect(BuffQueryMap.preview({ id: "u", index: 2, text: "", answer: "", running: false }).title).toBe("Request 2")
})
