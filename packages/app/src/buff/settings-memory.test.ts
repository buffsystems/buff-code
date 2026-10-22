// Настройки (#460): открываются на вкладке, где их закрыли.
import { beforeEach, expect, test } from "bun:test"
import { lastSettingsTab, rememberSettingsTab } from "./settings-memory"

beforeEach(() => localStorage.clear())

test("nothing remembered — general", () => {
  expect(lastSettingsTab(["general", "shortcuts"])).toBe("general")
})

test("the tab last open comes back", () => {
  rememberSettingsTab("shortcuts")
  expect(lastSettingsTab(["general", "shortcuts"])).toBe("shortcuts")
})

test("a tab that no longer exists falls back to general", () => {
  rememberSettingsTab("gone")
  expect(lastSettingsTab(["general", "shortcuts"])).toBe("general")
})
