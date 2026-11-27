// Режим «Настройка» (#765): инструкции режима, подтверждение перехода, универсальность промптов.
import { describe, expect, test } from "bun:test"
import { BuffSetup } from "@opencode/schema/buff-setup"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffChatPluginTools } from "../../src/buff/chat-plugin-tools"
import { BuffSetupPlugin } from "../../src/buff/setup"

/** Режим универсален: ни один сервис, протокол или бренд не назван ни в одном промпте. */
const SERVICE_WORDS = /\b(gmail|google|figma|slack|notion|jira|imap|smtp|outlook|dropbox|github|telegram|yandex)\b/i

describe("the mode prompt", () => {
  test("the setup agent gets its own instructions in the user's language", () => {
    const ru = BuffSetupPlugin.systemPart("setup", "ru")
    expect(ru).toContain("You are in Self-setup mode")
    expect(ru).toContain("Speak Russian")
    expect(BuffSetupPlugin.systemPart("setup", "en")).toContain("Speak English")
    expect(ru).not.toContain("{{language}}")
  })
  test("every other agent gets the offer to switch, not the mode", () => {
    for (const agent of ["build", "plan", "custom"]) {
      const part = BuffSetupPlugin.systemPart(agent, "en")
      expect(part).toContain("session_open")
      expect(part).not.toContain("You are in Self-setup mode")
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
    expect(lines).toEqual(["Открыть чат самонастройки «Рабочая почта»", "Задача: Искать письма"])
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

// Плагины чатов (#595): режим учит модель рисовать данные человека и остаётся универсальным.
describe("teaching itself a visual", () => {
  const texts = Object.values(BuffChatPluginTools.descriptions)
  test("the mode walks the plugin through look → agree → write → test → show", () => {
    const mode = BuffSetupPlugin.systemPart("setup", "en")
    for (const tool of ["chat_plugin_list", "chat_plugin_guide", "chat_plugin_save", "chat_plugin_test"])
      expect(mode).toContain(tool)
    expect(mode).toContain("never report a plugin you have not seen pass")
  })
  test("other modes offer to make a visual they cannot draw, through the same switch", () => {
    const offer = BuffSetupPlugin.systemPart("build", "en")
    expect(offer).toContain("visual")
    expect(offer).toContain("session_open")
  })
  test("the author is told the frame has no network and to paint with the app's own colours", () => {
    const author = BuffChatPluginTools.descriptions.author
    expect(author).toContain("no network")
    for (const name of ["buff.onBlock", "buff.sendMessage", "buff.updateContext", "--chart-1", "--color-text-primary"])
      expect(author).toContain(name)
    expect(author).toContain("never hard-code a colour")
  })
  test("no service or library names anywhere: the tools are universal", () => {
    for (const text of texts) expect(text).not.toMatch(SERVICE_WORDS)
    for (const text of texts) expect(text).not.toMatch(/\b(echarts|chart\.js|d3|plotly|vega|recharts|react)\b/i)
  })
})
