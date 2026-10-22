// Память из интерфейса (#446): слова, общие для окна и консоли.
import { describe, expect, test } from "bun:test"
import { BuffMemory } from "../src/buff-memory.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const now = Date.UTC(2026, 9, 2, 12, 0, 0)
const minute = 60_000

describe("when a file was changed", () => {
  test("recent changes are said in words", () => {
    expect(BuffMemory.changed(now - 20_000, now, ru)).toBe("только что")
    expect(BuffMemory.changed(now - 10 * minute, now, ru)).toBe("10 мин назад")
    expect(BuffMemory.changed(now - 3 * 60 * minute, now, ru)).toBe("3 ч назад")
    expect(BuffMemory.changed(now - 26 * 60 * minute, now, ru)).toBe("вчера")
  })

  test("older ones — by the date", () => {
    expect(BuffMemory.changed(Date.UTC(2026, 8, 20, 9, 0, 0), now, ru)).toBe("20.09.2026")
  })
})

describe("what a row says", () => {
  const file = { path: "/p/AGENTS.md", scope: "project" as const, exists: true, enabled: true, modified: now - minute }

  test("an existing file: when it changed", () => {
    expect(BuffMemory.note(file, true, now, ru)).toBe("изменён 1 мин назад")
  })

  test("a file that is not there yet", () => {
    expect(BuffMemory.note({ ...file, exists: false, modified: undefined }, true, now, ru)).toBe(
      "Файла ещё нет — он появится, когда вы запишете в него первую заметку.",
    )
  })

  test("switched off — by itself or with all memory", () => {
    expect(BuffMemory.note({ ...file, enabled: false }, true, now, ru)).toBe("Выключен: модель его не читает.")
    expect(BuffMemory.note(file, false, now, ru)).toBe("Память выключена: модель его не читает.")
  })
})

test("which scope a file belongs to — in words", () => {
  expect(BuffMemory.scopeTitle("user", ru)).toBe("Ваша память — во всех проектах")
  expect(BuffMemory.scopeTitle("project", ru)).toBe("Память проекта")
})
