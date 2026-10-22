// Выбор вкладок сессий живёт во «Внешнем виде» (#470): поиск по настройкам должен вести туда,
// а не на страницу экспериментов, где этого переключателя больше нет.
import { expect, test } from "bun:test"
import { clientSettings } from "@/settings/search-catalog"

test("the tab layout search result opens Appearance, where the control is", () => {
  expect(clientSettings.find((entry) => entry.target === "settings-tab-layout")?.tab).toBe("appearance")
})
