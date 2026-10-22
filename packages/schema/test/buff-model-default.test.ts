// Модель по умолчанию без выбора человека (#562): не случайная запись каталога агрегатора.
import { expect, test } from "bun:test"
import { BuffModelDefault } from "../src/buff-model-default.js"

const m = (providerID: string, id: string, released = "2026-01-01", tools = true) => ({
  providerID,
  id,
  released,
  tools,
})

test("an aggregator's newest obscure model loses to a well-known vendor's tool-capable one", () => {
  const models = [
    m("openrouter", "prism-ml/ternary-bonsai-2-27b", "2026-10-10"),
    m("openrouter", "z-ai/glm-5.3-flash", "2026-09-01"),
    m("openrouter", "anthropic/claude-sonnet-5", "2026-08-01"),
    m("openrouter", "anthropic/claude-haiku-3", "2024-03-01"),
    m("openrouter", "openai/gpt-6-no-tools", "2026-10-01", false),
  ]
  expect(BuffModelDefault.pick(models)?.id).toBe("anthropic/claude-sonnet-5")
})

test("a direct provider's own vendor counts; without known vendors — the newest, then the first", () => {
  expect(BuffModelDefault.pick([m("openai", "gpt-4o", "2024-05-01"), m("openai", "gpt-6", "2026-06-01")])?.id).toBe(
    "gpt-6",
  )
  expect(BuffModelDefault.pick([m("litellm", "a", ""), m("litellm", "b", "")])?.id).toBe("a")
  expect(BuffModelDefault.pick([m("x", "old", "2020-01-01"), m("x", "new", "2026-01-01")])?.id).toBe("new")
  expect(BuffModelDefault.pick([])).toBeUndefined()
})
