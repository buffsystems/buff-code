// Свои OpenAI-совместимые провайдеры в файле конфигурации (#562): чтение и правка текста,
// остальное в файле не трогается, ключа в файле нет.
import { describe, expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import { BuffProviderFile } from "@opencode/core/buff/provider-file"
import { BuffProvider } from "@opencode/schema/buff-provider"

const draft = {
  name: "LiteLLM",
  baseURL: "http://localhost:4000/v1/",
  models: [{ id: "gpt-4o" }, { id: "claude", name: "Claude" }],
}

describe("reading", () => {
  test("a provider with a server address is own; others are not", () => {
    const text = `{
      // мои провайдеры
      "providers": {
        "litellm": { "name": "LiteLLM", "settings": { "baseURL": "http://h/v1" }, "models": { "a": {}, "b": { "name": "B" } } },
        "openai": { "settings": { "timeout": 5 } },
      },
    }`
    expect(BuffProviderFile.providers(text)).toEqual([
      { id: "litellm", name: "LiteLLM", baseURL: "http://h/v1", models: [{ id: "a" }, { id: "b", name: "B" }] },
    ])
  })

  test("an empty file has none; a broken one is refused", () => {
    expect(BuffProviderFile.providers("")).toEqual([])
    expect(() => BuffProviderFile.providers("{ nope")).toThrow()
  })
})

describe("writing", () => {
  test("a new provider is written with its package, address and models — and no key", () => {
    const text = BuffProviderFile.withProvider("", "litellm", draft)
    expect(JSON.parse(text)).toEqual({
      providers: {
        litellm: {
          name: "LiteLLM",
          package: BuffProvider.PACKAGE,
          settings: { baseURL: "http://localhost:4000/v1" },
          // Сервер за шлюзом (LiteLLM → Anthropic) отказывает на незнакомом `store`.
          models: {
            "gpt-4o": { compatibility: { supportsStore: false } },
            claude: { compatibility: { supportsStore: false }, name: "Claude" },
          },
        },
      },
    })
    expect(text).not.toContain("key")
  })

  test("editing keeps comments, other settings and what was added by hand", () => {
    const before = `{
  // мой файл
  "model": "litellm/gpt-4o",
  "providers": {
    "litellm": {
      "name": "Old",
      "headers": { "X-Team": "a" },
      "settings": { "baseURL": "http://old/v1", "timeout": 30 },
      "models": { "gpt-4o": { "limit": { "context": 128000 } }, "gone": {}, "kept": { "compatibility": { "supportsStore": true } } }
    }
  }
}
`
    const after = BuffProviderFile.withProvider(before, "litellm", {
      ...draft,
      models: [{ id: "gpt-4o" }, { id: "kept" }],
    })
    expect(after).toContain("// мой файл")
    expect(parse(after).providers.litellm).toEqual({
      name: "LiteLLM",
      package: BuffProvider.PACKAGE,
      headers: { "X-Team": "a" },
      settings: { baseURL: "http://localhost:4000/v1", timeout: 30 },
      // Совместимость, заданная руками, остаётся.
      models: {
        "gpt-4o": { compatibility: { supportsStore: false }, limit: { context: 128000 } },
        kept: { compatibility: { supportsStore: true } },
      },
    })
  })

  test("removing takes only that provider; removing a missing one changes nothing", () => {
    const two = BuffProviderFile.withProvider(BuffProviderFile.withProvider("", "a", draft), "b", draft)
    expect(Object.keys(JSON.parse(BuffProviderFile.withProvider(two, "a", undefined)).providers)).toEqual(["b"])
    expect(BuffProviderFile.withProvider(two, "zzz", undefined)).toBe(two)
  })
})

describe("the form", () => {
  test("a draft that cannot be saved says why", () => {
    const good = { id: "litellm", ...draft }
    expect(BuffProvider.draftProblem(good)).toBeUndefined()
    expect(BuffProvider.draftProblem({ ...good, id: "My LLM" })).toContain("lowercase")
    expect(BuffProvider.draftProblem({ ...good, id: "buff" })).toContain("buff")
    expect(BuffProvider.draftProblem({ ...good, baseURL: "localhost:4000" })).toContain("http://")
    expect(BuffProvider.draftProblem({ ...good, models: [{ id: " " }] })).toContain("model")
  })
})
