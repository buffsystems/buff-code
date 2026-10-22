// Buff (#470): группа из одних служебных отметок называется по самим отметкам («Цель»), а не
// общим «Обновления»; отметка с итогом (metadata.summary) показывает его рядом с названием.
import { expect, test } from "bun:test"
import { noticeGroupTitle, noticeSummary } from "./buff-notice"

test("группа отметок называется их различными названиями по порядку", () => {
  expect(noticeGroupTitle(["Цель", "Цель"])).toBe("Цель")
  expect(noticeGroupTitle(["Цель", undefined, "Навык", ""])).toBe("Цель, Навык")
})

test("без названий — нет своего заголовка", () => {
  expect(noticeGroupTitle([])).toBeUndefined()
  expect(noticeGroupTitle([undefined, ""])).toBeUndefined()
})

test("итог отметки — только непустая строка из metadata.summary", () => {
  expect(noticeSummary({ source: "buff-goal", summary: "Достигнута: 3" })).toBe("Достигнута: 3")
  expect(noticeSummary({ summary: "" })).toBeUndefined()
  expect(noticeSummary({ summary: 3 })).toBeUndefined()
  expect(noticeSummary(undefined)).toBeUndefined()
})
