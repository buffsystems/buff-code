// Список дел в консоли (#463): отметки строк — готово, в работе, ждёт.
import { expect, test } from "bun:test"
import { todoLines } from "../../src/feature-plugins/buff/todo-view"

test("each item with its mark", () => {
  expect(
    todoLines([
      { content: "Прочитать код", status: "completed" },
      { content: "Написать тест", status: "in_progress" },
      { content: "Исправить", status: "pending" },
    ]),
  ).toEqual(["✓ Прочитать код", "◐ Написать тест", "○ Исправить"])
})
