import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Info, Patch } from "@opencode/schema/config"
import { patchConfigText } from "@opencode/core/config"

// Режимы ИИ (#835, эпик #783): дефолты Buff Code — уровень мышления и окно контекста — в конфиге,
// рядом с моделью; окно и консоль пишут их тем же патчем, что и shell.
describe("config defaults for AI modes", () => {
  test("the config takes a default thinking level and a context cap", () => {
    const info = Schema.decodeUnknownSync(Info)({ thinking: "high", context: 200000 })
    expect(info.thinking).toBe("high")
    expect(info.context).toBe(200000)
    expect(() => Schema.decodeUnknownSync(Info)({ context: -1 })).toThrow()
    expect(() => Schema.decodeUnknownSync(Info)({ context: 1.5 })).toThrow()
  })

  test("the patch names each default or clears it with null", () => {
    expect(Schema.decodeUnknownSync(Patch)({ thinking: "low" })).toEqual({ thinking: "low" })
    expect(Schema.decodeUnknownSync(Patch)({ context: null, shell: null })).toEqual({ context: null, shell: null })
  })

  test("patching the config text sets, replaces and removes keys, leaving the rest intact", () => {
    const text = '{\n  "model": "litellm/glm",\n  "shell": "/bin/zsh"\n}\n'
    const set = patchConfigText(text, { thinking: "high", context: 200000 })
    expect(JSON.parse(set)).toEqual({ model: "litellm/glm", shell: "/bin/zsh", thinking: "high", context: 200000 })
    const cleared = patchConfigText(set, { thinking: null, shell: null })
    expect(JSON.parse(cleared)).toEqual({ model: "litellm/glm", context: 200000 })
    expect(patchConfigText("{}\n", {})).toBe("{}\n")
  })
})
