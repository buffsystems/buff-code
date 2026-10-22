export * as BuffTodo from "./buff-todo.js"

import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Список дел (#463), как в ZCode: модель ведёт его инструментом `todo_update` — весь список
 * каждый раз. Текущий список — последний выполненный вызов в сессии: он переживает перезапуск
 * и одинаково виден в окне и консоли. Здесь — прогресс, текущее дело и проверка списка.
 */

export const TOOL = "todo_update"

export const Status = Schema.Literals(["pending", "in_progress", "completed"])
export type Status = typeof Status.Type

export const Item = Schema.Struct({
  content: Schema.String.annotate({ description: "What to do, in the user's language." }),
  status: Status,
})
export type Item = typeof Item.Type

const decode = Schema.decodeUnknownOption(Schema.Array(Item))

export function progress(items: readonly Item[]) {
  const done = items.filter((item) => item.status === "completed").length
  const current = items.find((item) => item.status === "in_progress") ?? items.find((item) => item.status === "pending")
  return { done, total: items.length, ...(current ? { current: current.content } : {}) }
}

export function line(items: readonly Item[], t: BuffI18n.T = BuffI18n.english): string {
  const state = progress(items)
  return t("To-dos {done}/{total} · {current}", {
    done: state.done,
    total: state.total,
    current: state.current ?? t("all done"),
  })
}

/** Что не так со списком — модели, по-английски: она исправит и вызовет снова. */
export function problems(items: readonly Item[]): string[] {
  return [
    ...items.flatMap((item, index) => (item.content.trim() ? [] : [`Item ${index + 1} has no content.`])),
    ...(items.filter((item) => item.status === "in_progress").length > 1
      ? ["Only one item may be in_progress at a time."]
      : []),
  ]
}

type Part = { readonly type?: unknown; readonly name?: unknown; readonly state?: unknown }
type Message = { readonly type?: unknown; readonly content?: unknown }

/** Последний список дел в сообщениях сессии (по порядку сообщений); нет — ничего. */
export function latest(messages: readonly Message[]): readonly Item[] | undefined {
  const found = messages
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as Part[]) : []))
    .findLast((part) => {
      const state = part.state as { status?: unknown } | undefined
      return part.type === "tool" && part.name === TOOL && state?.status === "completed"
    })
  return found ? fromInput((found.state as { input?: unknown }).input) : undefined
}

/** Список из входа вызова `todo_update`; не читается — ничего. */
export function fromInput(input: unknown): readonly Item[] | undefined {
  const todos = typeof input === "object" && input !== null ? (input as { todos?: unknown }).todos : undefined
  const decoded = decode(todos)
  return decoded._tag === "Some" ? decoded.value : undefined
}
