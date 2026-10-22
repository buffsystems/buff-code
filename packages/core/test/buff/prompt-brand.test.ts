import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { SystemPart } from "@opencode/ai"
import { Agent } from "@opencode/core/agent"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode/core/codemode/instructions"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { OpenCodeTools } from "@opencode/core/tool/plugin/opencode"
import { Model } from "@opencode/schema/model"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

// #623: модель работает в Buff Code и не должна узнавать из промпта, что под ним opencode.
// Сторож падает, если подъём апстрима вернёт чужое имя в то, что уходит модели.

const it = testEffect(PluginTestLayer)
const src = path.join(import.meta.dir, "..", "..", "src")

/** Шаблоны, из которых собираются системные промпты и команды. Навыки апстрима (skill/*.md)
 *  не входят: их плагин вырезан и у разработчика, и у раннера (BuffBrand). */
const TEMPLATES = [
  "session/runner/prompt/system.txt",
  "plugin/system-prompt/anthropic.txt",
  "plugin/system-prompt/gpt-astra.txt",
  "plugin/system-prompt/gpt.txt",
  "plugin/system-prompt/kimi.txt",
  "plugin/system-prompt/meta.txt",
  "plugin/system-prompt/trinity.txt",
  "plugin/command/initialize.txt",
  "plugin/command/review.txt",
  "tool/patch.txt",
]

/** Что модели видеть можно: подстановки, которые заменяются до отправки, и настоящее имя
 *  старого файла конфигурации, который /init должен узнать в репозитории. */
const visible = (text: string) => text.replace(/\$\{OPENCODE_[A-Z_]+\}/g, "").replace("legacy `opencode.json`", "")

describe("промпт Buff Code не называет opencode (#623)", () => {
  test("шаблоны промптов", () => {
    for (const file of TEMPLATES)
      expect({ file, opencode: /opencode/i.test(visible(readFileSync(path.join(src, file), "utf8"))) }).toEqual({
        file,
        opencode: false,
      })
  })

  it.effect("каталог Code Mode и подсказка про перенос сессии", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* PluginHost.make(yield* Plugin.Service)
      yield* OpenCodeTools.Plugin.effect(pluginHost)

      const catalog = (yield* (yield* Tool.Service).snapshot()).codeModeCatalog
      expect(catalog).toBeDefined()
      const rendered = CodeModeInstructions.render(CodeModeCatalog.summarize(catalog!, { budget: Infinity }))
      expect(rendered).toContain("tools.buff.session_move")
      expect(rendered).not.toMatch(/opencode/i)

      const context = {
        sessionID: Session.ID.make("ses_prompt_brand"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("alpha") }),
        system: [SystemPart.make("Agent prompt")],
        messages: [],
        tools: {},
        options: {},
      }
      yield* hooks.trigger("session", "context", context)
      const system = context.system.map((part) => part.text).join("\n")
      expect(system).toContain("tools.buff.session_move")
      expect(system).not.toMatch(/opencode/i)
    }),
  )
})
