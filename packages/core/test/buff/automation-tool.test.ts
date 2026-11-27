// Автоматизации (#447): модель создаёт автоматизацию инструментом, человек подтверждает.
import { describe, expect, test } from "bun:test"
import { BuffAutomationTool } from "../../src/buff/automation-tool"

const input = {
  title: "Утренний отчёт",
  prompt: "Собери сводку по вчерашним коммитам",
  schedule: { kind: "daily", at: "09:00" },
  mode: "edit",
} as const

describe("the create-automation tool", () => {
  test("the draft runs in the session's project with the session's model", () => {
    expect(BuffAutomationTool.draft(input, "/p", { id: "m", providerID: "buff" })).toEqual({
      ...input,
      directory: "/p",
      model: { id: "m", providerID: "buff" },
    })
    expect(BuffAutomationTool.draft(input, "/p", undefined).model).toBeUndefined()
  })
  test("the person confirms what, when and where — line by line", () => {
    expect(BuffAutomationTool.resources(BuffAutomationTool.draft(input, "/p", undefined))).toEqual([
      "«Утренний отчёт» — Ежедневно в 09:00, в /p, режим «Править сам».",
      "Задача: Собери сводку по вчерашним коммитам",
    ])
  })
  test("the model hears what was created and when it runs next", () => {
    const now = new Date("2026-10-05T08:00:00")
    const automation = {
      ...BuffAutomationTool.draft(input, "/p", undefined),
      next: new Date("2026-10-05T09:00:00").getTime(),
    }
    expect(BuffAutomationTool.reply(automation, now)).toBe(
      "Automation «Утренний отчёт» created: Daily at 09:00. Next run — today at 09:00. It is visible on the «Automations» page.",
    )
  })
})

// Живая проверка #969: машина облака живёт в UTC, а человек назвал время по своим часам.
describe("the time zone of an automation the model creates", () => {
  test("the asker's zone is put on a clock-time schedule; an interval has none; a zone named stays", () => {
    expect(BuffAutomationTool.draft(input, "/p", undefined, "Europe/Berlin").schedule).toEqual({
      kind: "daily",
      at: "09:00",
      zone: "Europe/Berlin",
    })
    const interval = { ...input, schedule: { kind: "interval", every: 2, unit: "hours" } } as const
    expect(BuffAutomationTool.draft(interval, "/p", undefined, "Europe/Berlin").schedule).toEqual(interval.schedule)
    const named = { ...input, schedule: { kind: "daily", at: "09:00", zone: "Asia/Tokyo" } } as const
    expect(BuffAutomationTool.draft(named, "/p", undefined, "Europe/Berlin").schedule).toEqual(named.schedule)
    expect(BuffAutomationTool.draft(input, "/p", undefined, undefined).schedule).toEqual(input.schedule)
  })
  test("the model hears the next run by the person's clock", () => {
    const automation = {
      ...BuffAutomationTool.draft(input, "/p", undefined, "Europe/Berlin"),
      next: new Date("2026-11-26T08:00:00Z").getTime(),
    }
    expect(BuffAutomationTool.reply(automation, new Date("2026-11-25T12:00:00Z"))).toContain("tomorrow at 09:00")
    // #970 (live): «Daily at 09:00» of another zone read as the user's own clock — the zone is named.
    expect(BuffAutomationTool.reply(automation, new Date("2026-11-25T12:00:00Z"))).toContain(
      "Daily at 09:00, Europe/Berlin time. Next run",
    )
  })
})

describe("the person always confirms", () => {
  test("allowed by any rule — still asked; denied stays denied; other actions untouched", () => {
    expect(BuffAutomationTool.confirmed({ action: "buff_automation", effect: "allow" })).toBe("ask")
    expect(BuffAutomationTool.confirmed({ action: "buff_automation", effect: "deny" })).toBe("deny")
    expect(BuffAutomationTool.confirmed({ action: "buff_automation", effect: "ask" })).toBe("ask")
    expect(BuffAutomationTool.confirmed({ action: "edit", effect: "allow" })).toBe("allow")
  })
})
