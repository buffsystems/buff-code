import type { BuffTodo } from "@opencode/schema/buff-todo"

/** Список дел в консоли (#463): строка на дело с отметкой — готово, в работе, ждёт. */
const MARK: Record<BuffTodo.Status, string> = { completed: "✓", in_progress: "◐", pending: "○" }

export function todoLines(items: readonly BuffTodo.Item[]): string[] {
  return items.map((item) => `${MARK[item.status]} ${item.content}`)
}
