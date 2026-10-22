import { expect, test } from "bun:test"
import { createTranslator, english, loadDictionary, normalizeLocale } from "./i18n"

test("English comes from the app and ui dictionaries, branded", () => {
  const { t } = createTranslator("en", english)
  expect(t("common.requestFailed")).toBe(english["common.requestFailed"] ?? "")
  expect(Object.values(english).some((value) => value.includes("OpenCode Desktop"))).toBe(false)
})

test("Russian loads on demand and falls back to English for missing keys", async () => {
  const ru = await loadDictionary("ru")
  const { t } = createTranslator("ru", ru)
  expect(t("common.requestFailed")).not.toBe(english["common.requestFailed"])
  expect(ru["ui.sessionReview.title"]).toBe("Изменения сессии")
})

test("templates fill every named parameter", () => {
  const { t } = createTranslator("en", { "ssh.connectTo": "Connect to {{host}} as {{ host }}" })
  expect(t("ssh.connectTo", { host: "box" })).toBe("Connect to box as box")
})

test("plurals pick the locale's category with an .other fallback", () => {
  const dictionary = { "item.one": "{{count}} item", "item.other": "{{count}} items", "file.many": "{{count}} файлов" }
  expect(createTranslator("en", dictionary).plural("item", 1)).toBe("1 item")
  expect(createTranslator("en", dictionary).plural("item", 3)).toBe("3 items")
  expect(createTranslator("ru", dictionary).plural("file", 5)).toBe("5 файлов")
})

test("Buff strings translate through the shared catalog", () => {
  expect(createTranslator("en", english).buff.t("Archive")).toBe("Archive")
  expect(createTranslator("ru", english).buff.n(2, "{n} file|{n} files")).toContain("2")
})

test("only offered locales survive, Russian by default", () => {
  expect(normalizeLocale("ru")).toBe("ru")
  expect(normalizeLocale("de")).toBe("en")
  expect(normalizeLocale(undefined)).toBe("ru")
})
