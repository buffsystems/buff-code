// Переводы Buff (#472): строка в коде — английская, русский — из каталога; параметры и множественное число.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"

const catalog = {
  Automations: "Автоматизации",
  "Next run — {when}": "Следующий запуск — {when}",
  "{n} run|{n} runs": "{n} запуск|{n} запуска|{n} запусков",
}
const t = BuffI18n.translator(catalog)

describe("перевод Buff", () => {
  test("английский — исходная строка, русский — из каталога", () => {
    expect(t("en", "Automations")).toBe("Automations")
    expect(t("ru", "Automations")).toBe("Автоматизации")
  })

  test("строки нет в каталоге — остаётся исходная (сторож тестов ловит это раньше)", () => {
    expect(t("ru", "Unknown text")).toBe("Unknown text")
  })

  test("параметры подставляются в обоих языках", () => {
    expect(t("en", "Next run — {when}", { when: "tomorrow" })).toBe("Next run — tomorrow")
    expect(t("ru", "Next run — {when}", { when: "завтра" })).toBe("Следующий запуск — завтра")
  })

  test("множественное число — по правилам языка", () => {
    const runs = (locale: BuffI18n.Locale, n: number) => BuffI18n.plural(catalog)(locale, n, "{n} run|{n} runs")
    expect([1, 2, 5].map((n) => runs("en", n))).toEqual(["1 run", "2 runs", "5 runs"])
    expect([1, 3, 5, 11, 21, 22].map((n) => runs("ru", n))).toEqual([
      "1 запуск",
      "3 запуска",
      "5 запусков",
      "11 запусков",
      "21 запуск",
      "22 запуска",
    ])
  })

  test("язык по умолчанию — русский; предлагаются русский и английский", () => {
    expect(BuffI18n.DEFAULT_LOCALE).toBe("ru")
    expect(BuffI18n.locale("en")).toBe("en")
    expect(BuffI18n.locale("de")).toBe("ru")
    expect(BuffI18n.locale(undefined)).toBe("ru")
  })
})

describe("каталог Buff", () => {
  test("области не спорят: одна английская строка — один перевод", async () => {
    const { AREAS } = await import("../src/buff-i18n/ru.js")
    const seen = new Map<string, string>()
    const clash: string[] = []
    for (const [area, catalog] of Object.entries(AREAS))
      for (const [key, value] of Object.entries(catalog)) {
        const other = seen.get(key)
        if (other !== undefined && other !== value) clash.push(`${area}: «${key}»`)
        seen.set(key, value)
      }
    expect(clash).toEqual([])
  })

  test("общий перевод знает строки областей", () => {
    expect(BuffI18n.t("ru", "Automations")).toBe("Автоматизации")
    expect(BuffI18n.t("en", "Automations")).toBe("Automations")
  })
})
