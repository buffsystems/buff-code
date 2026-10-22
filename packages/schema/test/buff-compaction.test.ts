// Buff (#470): сводка сжатия написана для модели. В ленте она под переключателем: раскрытой
// она выглядела так, будто сессия всё забыла («(none) — await the user's first request»),
// хотя свежая часть разговора сохранена дословно. Пока сжатие идёт — сводку видно, как её пишут.
import { expect, test } from "bun:test"
import { BuffCompaction } from "../src/buff-compaction.js"

test("готовая сводка скрыта, пока её не раскрыли", () => {
  expect(BuffCompaction.summaryShown("completed", false)).toBe(false)
  expect(BuffCompaction.summaryShown("completed", true)).toBe(true)
})

test("сводку, которую пишут сейчас, видно", () => {
  expect(BuffCompaction.summaryShown("running", false)).toBe(true)
})

test("у сбоя сводки нет", () => {
  expect(BuffCompaction.summaryShown("failed", true)).toBe(false)
})
