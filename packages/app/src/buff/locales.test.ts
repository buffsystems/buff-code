// В выборе языка Buff Code — только английский и русский (#469): остальные переводы апстрима
// остаются в репозитории нетронутыми, но не предлагаются и не восстанавливаются из состояния.
import { expect, test } from "bun:test"
import { DEFAULT_LOCALE, OFFERED_LOCALES, offeredLocale, systemLocale } from "./locales"

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

// #713: пока язык не выбран — язык системы; ни русский, ни английский — русский.
test("with nothing chosen yet the window speaks the system's language, Russian otherwise", () => {
  expect(DEFAULT_LOCALE).toBe("ru")
  expect(systemLocale(["en-US", "ru"])).toBe("en")
  expect(systemLocale(["de-DE", "ru-RU"])).toBe("ru")
  expect(systemLocale(["de-DE"])).toBe("ru")
  expect(systemLocale([])).toBe("ru")
})
