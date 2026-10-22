// Заголовки команд из сохранённого каталога (#472): записаны на языке, что был при регистрации;
// показываются на текущем.
import { expect, test } from "bun:test"
import { catalogTitle } from "./catalog-title"

test("строка апстрима — на текущем языке, с какого бы ни была записана", () => {
  expect(catalogTitle("Cycle session location", "ru")).toBe("Сменить каталог сессии")
  expect(catalogTitle("Сменить каталог сессии", "en")).toBe("Cycle session location")
  expect(catalogTitle("Search projects", "ru")).toBe("Поиск проектов")
})

test("строка Buff — так же", () => {
  expect(catalogTitle("Automations", "ru")).toBe("Автоматизации")
  expect(catalogTitle("Автоматизации", "en")).toBe("Automations")
})

test("уже на нужном языке или незнакомая — как есть", () => {
  expect(catalogTitle("Автоматизации", "ru")).toBe("Автоматизации")
  expect(catalogTitle("my-plugin: run", "ru")).toBe("my-plugin: run")
})
