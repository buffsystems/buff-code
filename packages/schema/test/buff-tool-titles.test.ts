// Названия инструментов Buff в ленте (#470): человеческие, как у инструментов апстрима, а не workflow_create.
import { expect, test } from "bun:test"
import { BuffToolTitles } from "../src/buff-tool-titles.js"
import { BuffI18n } from "../src/buff-i18n.js"

test("наши инструменты названы словами — по-английски в коде, по-русски из каталога", () => {
  expect(BuffToolTitles.of("workflow_create")).toBe("Start a workflow")
  expect(BuffI18n.t("ru", BuffToolTitles.of("workflow_create")!)).toBe("Запуск сценария")
  expect(BuffI18n.t("ru", BuffToolTitles.of("todo_update")!)).toBe("Список дел")
  expect(BuffI18n.t("ru", BuffToolTitles.of("knowledge_read_entry")!)).toBe("База знаний: запись")
})

test("у каждого названия есть перевод", () => {
  for (const title of BuffToolTitles.all()) expect(BuffI18n.t("ru", title)).not.toBe(title)
})

test("чужое имя — без названия: лента покажет его как есть", () => {
  expect(BuffToolTitles.of("my_mcp_tool")).toBeUndefined()
})
