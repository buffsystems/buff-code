// Редактор автоматизации (#447): одна форма на все виды расписания — смена вида не теряет время и дни.
import { describe, expect, test } from "bun:test"
import { draftOf, formOf, modelKey, scheduleOf } from "./editor-state"

describe("the editor form", () => {
  test("a new automation starts daily at 09:00 in the given project, edits allowed", () => {
    const form = formOf(undefined, "/p")
    expect(scheduleOf(form)).toEqual({ kind: "daily", at: "09:00" })
    expect(form.directory).toBe("/p")
    expect(form.mode).toBe("edit")
  })
  test("switching the kind keeps the time and the days", () => {
    const form = { ...formOf(undefined, "/p"), at: "07:30", days: [1, 3] }
    expect(scheduleOf({ ...form, kind: "weekly" })).toEqual({ kind: "weekly", days: [1, 3], at: "07:30" })
    expect(scheduleOf({ ...form, kind: "weeks", every: 2 })).toEqual({
      kind: "weeks",
      every: 2,
      days: [1, 3],
      at: "07:30",
    })
    expect(scheduleOf({ ...form, kind: "monthly", day: 15 })).toEqual({ kind: "monthly", day: 15, at: "07:30" })
    expect(scheduleOf({ ...form, kind: "interval", every: 30, unit: "minutes" })).toEqual({
      kind: "interval",
      every: 30,
      unit: "minutes",
    })
  })
  test("an existing automation round-trips, model included", () => {
    const draft = {
      title: "Отчёт",
      prompt: "Сводка",
      schedule: { kind: "weeks", every: 2, days: [1, 4], at: "09:00" },
      directory: "/p",
      mode: "full",
      model: { id: "glm", providerID: "buff" },
    } as const
    const form = formOf(draft, "/other")
    expect(form.model).toBe("buff/glm")
    expect(draftOf(form)).toEqual(draft)
  })
  test("no model chosen — the project's default", () => {
    expect(draftOf({ ...formOf(undefined, "/p"), title: "a", prompt: "b" }).model).toBeUndefined()
    expect(modelKey({ id: "a/b", providerID: "x" })).toBe("x/a/b")
  })
})
