// Режим «Настройка» (#765): инструкции режима, подтверждение перехода, универсальность промптов.
import { describe, expect, test } from "bun:test"
import { BuffSetup } from "@opencode/schema/buff-setup"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffSetupPlugin } from "../../src/buff/setup"

/** Режим универсален: ни один сервис, протокол или бренд не назван ни в одном промпте. */
const SERVICE_WORDS = /\b(gmail|google|figma|slack|notion|jira|imap|smtp|outlook|dropbox|github|telegram|yandex)\b/i

describe("the mode prompt", () => {
  test("the setup agent gets its own instructions in the user's language", () => {
    const ru = BuffSetupPlugin.systemPart("setup", "ru")
    expect(ru).toContain("You are in Setup mode")
    expect(ru).toContain("Speak Russian")
    expect(BuffSetupPlugin.systemPart("setup", "en")).toContain("Speak English")
    expect(ru).not.toContain("{{language}}")
  })
  test("every other agent gets the offer to switch, not the mode", () => {
    for (const agent of ["build", "plan", "custom"]) {
      const part = BuffSetupPlugin.systemPart(agent, "en")
      expect(part).toContain("session_open")
      expect(part).not.toContain("You are in Setup mode")
    }
  })
  test("no service names anywhere: the mode is universal", () => {
    expect(BuffSetupPlugin.systemPart("setup", "en")).not.toMatch(SERVICE_WORDS)
    expect(BuffSetupPlugin.systemPart("build", "en")).not.toMatch(SERVICE_WORDS)
    expect(BuffSetupPlugin.description).not.toMatch(SERVICE_WORDS)
  })
  test("secrets never go through the model: the prompt says so", () => {
    const mode = BuffSetupPlugin.systemPart("setup", "en")
    expect(mode).toContain("`secret` field")
    expect(mode).toContain("never see its value")
  })
})

describe("the person always confirms the switch", () => {
  test("allowed by any rule — still asked; denied stays denied; other actions untouched", () => {
    expect(BuffSetupPlugin.confirmed({ action: BuffSetup.PERMISSION_ACTION, effect: "allow" })).toBe("ask")
    expect(BuffSetupPlugin.confirmed({ action: BuffSetup.PERMISSION_ACTION, effect: "deny" })).toBe("deny")
    expect(BuffSetupPlugin.confirmed({ action: "edit", effect: "allow" })).toBe("allow")
  })
  test("what is confirmed — title and task, in the person's language", () => {
    const lines = BuffSetup.confirmation({ title: "Рабочая почта", task: "Искать письма" }, (text, params) =>
      BuffI18n.t("ru", text, params),
    )
    expect(lines).toEqual(["Открыть сессию настройки «Рабочая почта»", "Задача: Искать письма"])
  })
  test("the model hears where the setup continues and stops", () => {
    expect(BuffSetupPlugin.reply("ses_1")).toContain("ses_1")
    expect(BuffSetupPlugin.reply("ses_1")).toContain("then stop")
  })
})

test("a setup session is told by its agent", () => {
  expect(BuffSetup.isSetup({ agent: "setup" })).toBe(true)
  expect(BuffSetup.isSetup({ agent: "build" })).toBe(false)
  expect(BuffSetup.isSetup({})).toBe(false)
})
