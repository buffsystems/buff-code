// Русский словарь окна (#472): у каждой английской строки апстрима есть русская — из его словаря
// или из дополнения Buff; дополнение не перекрывает уже переведённое апстримом.
import { expect, test } from "bun:test"
import { dict as appEn } from "@/runtime/i18n/en"
import { dict as appRu } from "@/runtime/i18n/ru"
import { dict as uiEn } from "@opencode/ui/i18n/en"
import { dict as uiRu } from "@opencode/ui/i18n/ru"
import { RU_UPSTREAM } from "./ru-upstream"

const PLURAL = /\.(zero|one|two|few|many|other)$/
const upstreamRu = new Set([...Object.keys(appRu), ...Object.keys(uiRu)])
const ru = new Set([...upstreamRu, ...Object.keys(RU_UPSTREAM)])

test("every English string of the window has a Russian one (plural keys — in all Russian forms)", () => {
  const english = [...Object.keys(appEn), ...Object.keys(uiEn)]
  const forms = (base: string) => english.filter((key) => key.startsWith(`${base}.`) && PLURAL.test(key)).length
  const missing = new Set<string>()
  for (const key of english) {
    const base = key.replace(PLURAL, "")
    // Множественное — когда у основы две формы и больше; одиночный «.other» — это просто «Другое».
    if (base === key || forms(base) < 2) {
      if (!ru.has(key)) missing.add(key)
      continue
    }
    for (const form of ["one", "few", "many"]) if (!ru.has(`${base}.${form}`)) missing.add(`${base}.${form}`)
  }
  expect([...missing]).toEqual([])
})

test("the supplement only fills gaps — it does not override upstream translations", () => {
  expect(Object.keys(RU_UPSTREAM).filter((key) => upstreamRu.has(key))).toEqual([])
})

test("исправления перевода апстрима (#470) — только ключи, которые апстрим переводит, и только иначе", async () => {
  const { RU_UPSTREAM_FIXES } = await import("./ru-upstream")
  const upstream: Record<string, string> = { ...appRu, ...uiRu }
  const wrong = Object.entries(RU_UPSTREAM_FIXES).filter(([key, text]) => !(key in upstream) || upstream[key] === text)
  expect(wrong).toEqual([])
  expect(RU_UPSTREAM_FIXES["prompt.mode.normal"]).toBe("Обычный ввод")
  expect(RU_UPSTREAM_FIXES["command.review.toggle"]).toBe("Показать или скрыть изменения")
})
