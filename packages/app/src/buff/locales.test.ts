// В выборе языка Buff Code — только английский и русский (#469): остальные переводы апстрима
// остаются в репозитории нетронутыми, но не предлагаются и не восстанавливаются из состояния.
import { expect, test } from "bun:test"
import { DEFAULT_LOCALE, OFFERED_LOCALES, offeredLocale } from "./locales"

test("only English and Russian are offered", () => {
  expect([...OFFERED_LOCALES]).toEqual(["en", "ru"])
})

test("an offered language is kept", () => {
  expect(offeredLocale("ru")).toBe("ru")
  expect(offeredLocale("en")).toBe("en")
})

test("a language that is no longer offered falls back to English", () => {
  for (const stored of ["hr", "hu", "is", "lt", "de", "zh", "", "nonsense"]) expect(offeredLocale(stored)).toBe("en")
})

test("a stored language that is no longer offered is read as English", async () => {
  const { normalizeLocale } = await import("@/runtime/i18n/language")
  expect(normalizeLocale("hr")).toBe("en")
  expect(normalizeLocale("ru")).toBe("ru")
})

// #471: язык по умолчанию — русский при любом языке системы, как кабинет; английский — выбором.
test("with nothing chosen yet the window speaks Russian, whatever the system language", () => {
  expect(DEFAULT_LOCALE).toBe("ru")
})
