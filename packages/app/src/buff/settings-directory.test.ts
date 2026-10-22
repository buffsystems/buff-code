// Каталог, по которому настройки показывают подключение и модели (#466).
import { expect, test } from "bun:test"
import { settingsDirectory } from "./settings-directory"

test("project settings look at their own project", () => {
  expect(settingsDirectory("/work/shop", "/work/other")).toBe("/work/shop")
})

test("server settings look where the context was chosen last", () => {
  expect(settingsDirectory(undefined, "/work/other")).toBe("/work/other")
})

test("before any choice the server's own directory is all there is", () => {
  expect(settingsDirectory(undefined, null)).toBeUndefined()
  expect(settingsDirectory(undefined, undefined)).toBeUndefined()
})
