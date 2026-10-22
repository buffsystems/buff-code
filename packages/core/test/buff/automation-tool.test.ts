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

describe("the person always confirms", () => {
  test("allowed by any rule — still asked; denied stays denied; other actions untouched", () => {
    expect(BuffAutomationTool.confirmed({ action: "buff_automation", effect: "allow" })).toBe("ask")
    expect(BuffAutomationTool.confirmed({ action: "buff_automation", effect: "deny" })).toBe("deny")
    expect(BuffAutomationTool.confirmed({ action: "buff_automation", effect: "ask" })).toBe("ask")
    expect(BuffAutomationTool.confirmed({ action: "edit", effect: "allow" })).toBe("allow")
  })
})
