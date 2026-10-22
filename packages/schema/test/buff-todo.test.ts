// Список дел (#463): что модель ведёт по ходу работы — прогресс, текущее дело, проверка, последний список в сессии.
import { describe, expect, test } from "bun:test"
import { BuffTodo } from "../src/buff-todo.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const items: BuffTodo.Item[] = [
  { content: "Прочитать код", status: "completed" },
  { content: "Написать тест", status: "in_progress" },
  { content: "Исправить", status: "pending" },
]

describe("progress", () => {
  test("done of total and the current item", () => {
    expect(BuffTodo.progress(items)).toEqual({ done: 1, total: 3, current: "Написать тест" })
  })
  test("nothing in progress — the next pending one is current; all done — none", () => {
    expect(BuffTodo.progress([items[0]!, items[2]!]).current).toBe("Исправить")
    expect(BuffTodo.progress([items[0]!]).current).toBeUndefined()
  })
  test("one line for the bar", () => {
    expect(BuffTodo.line(items, ru)).toBe("Дела 1/3 · Написать тест")
    expect(BuffTodo.line([items[0]!], ru)).toBe("Дела 1/1 · всё сделано")
    expect(BuffTodo.line([items[0]!])).toBe("To-dos 1/1 · all done")
  })
})

describe("checking a list", () => {
  test("at most one item in progress; no empty items", () => {
    expect(BuffTodo.problems(items)).toEqual([])
    expect(BuffTodo.problems([...items, { content: "Ещё", status: "in_progress" }])).toEqual([
      "Only one item may be in_progress at a time.",
    ])
    expect(BuffTodo.problems([{ content: " ", status: "pending" }])).toEqual(["Item 1 has no content."])
  })
})

describe("a call's input", () => {
  test("its list, or nothing when malformed", () => {
    expect(BuffTodo.fromInput({ todos: items })).toEqual(items)
    expect(BuffTodo.fromInput({ todos: [{ content: "a", status: "maybe" }] })).toBeUndefined()
    expect(BuffTodo.fromInput(undefined)).toBeUndefined()
  })
})

describe("the latest list in a session", () => {
  const tool = (todos: unknown, status = "completed") => ({
    type: "tool",
    name: BuffTodo.TOOL,
    state: { status, input: { todos } },
  })
  test("the last completed call wins; others are ignored", () => {
    const messages = [
      { type: "assistant", content: [tool([{ content: "a", status: "pending" }])] },
      { type: "user", content: [] },
      {
        type: "assistant",
        content: [
          { type: "text", text: "x" },
          tool([{ content: "a", status: "completed" }]),
          tool([{ content: "b", status: "pending" }], "error"),
        ],
      },
    ]
    expect(BuffTodo.latest(messages)).toEqual([{ content: "a", status: "completed" }])
  })
  test("no list yet", () => {
    expect(BuffTodo.latest([{ type: "user", content: [] }])).toBeUndefined()
  })
})
