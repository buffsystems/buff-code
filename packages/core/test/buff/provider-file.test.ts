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

describe("what a model reads and writes (#27)", () => {
  test("the person's marks are written as capabilities and read back", () => {
    const text = BuffProviderFile.withProvider("", "own", {
      name: "Own",
      baseURL: "http://h/v1",
      models: [{ id: "llava", images: true }, { id: "flux", images: false, draws: true }, { id: "plain" }],
    })
    const models = JSON.parse(text).providers.own.models
    expect(models.llava.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
    expect(models.flux.capabilities).toEqual({ tools: true, input: ["text"], output: ["text", "image"] })
    expect(models.plain.capabilities).toBeUndefined()
    expect(BuffProviderFile.providers(text)[0]!.models).toEqual([
      { id: "llava", images: true, draws: false },
      { id: "flux", images: false, draws: true },
      { id: "plain" },
    ])
  })

  test("a server's list says what a model reads when it says it — OpenRouter's way or LiteLLM's", () => {
    expect(
      BuffProviderFile.listedModalities({
        id: "a",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      }),
    ).toEqual({ images: true, draws: false })
    expect(
      BuffProviderFile.listedModalities({ id: "b", input_modalities: ["text"], output_modalities: ["image", "text"] }),
    ).toEqual({ images: false, draws: true })
    expect(BuffProviderFile.listedModalities({ id: "c", model_info: { supports_vision: true } })).toEqual({
      images: true,
      draws: false,
    })
    expect(BuffProviderFile.listedModalities({ id: "d", object: "model" })).toBeNull()
  })
})

describe("a model's context window (#898)", () => {
  const draft = (models: BuffProvider.Model[]) => ({ name: "Mine", baseURL: "http://localhost:4000/v1", models })

  test("a window is written as the model's limit and read back; without one the model has none", () => {
    const text = BuffProviderFile.withProvider("", "mine", draft([{ id: "big", context: 1_000_000 }, { id: "plain" }]))
    const models = JSON.parse(text).providers.mine.models
    expect(models.big.limit).toEqual({ context: 1_000_000 })
    expect(models.plain.limit).toBeUndefined()
    expect(BuffProviderFile.providers(text)[0]?.models).toEqual([{ id: "big", context: 1_000_000 }, { id: "plain" }])
  })

  test("0 takes the window out and keeps the rest of the limit; saying nothing keeps the file's", () => {
    const start = `{ "providers": { "mine": { "settings": { "baseURL": "http://x/v1" }, "models": { "a": { "limit": { "context": 128000, "output": 8000 } }, "b": { "limit": { "context": 64000 } } } } } }`
    const text = BuffProviderFile.withProvider(start, "mine", draft([{ id: "a", context: 0 }, { id: "b" }]))
    const models = JSON.parse(text).providers.mine.models
    expect(models.a.limit).toEqual({ output: 8000 })
    expect(models.b.limit).toEqual({ context: 64000 })
    expect(BuffProviderFile.providers(text)[0]?.models).toEqual([
      { id: "a", output: 8000 },
      { id: "b", context: 64000 },
    ])
  })

  test("a server's list names the window its own way; a list that says nothing gives none", () => {
    expect(
      BuffProviderFile.listedWindow({
        id: "m",
        context_length: 262144,
        top_provider: { max_completion_tokens: 16384 },
      }),
    ).toEqual({ context: 262144, output: 16384 })
    expect(BuffProviderFile.listedWindow({ id: "m", max_model_len: 32768 })).toEqual({ context: 32768 })
    expect(BuffProviderFile.listedWindow({ id: "m", context_window: 131072 })).toEqual({ context: 131072 })
    expect(
      BuffProviderFile.listedWindow({ id: "m", model_info: { max_input_tokens: 200000, max_output_tokens: 64000 } }),
    ).toEqual({ context: 200000, output: 64000 })
    expect(BuffProviderFile.listedWindow({ id: "m", object: "model", owned_by: "openai" })).toBeNull()
    expect(
      BuffProviderFile.listedWindow({ id: "m", model_info: { max_input_tokens: null, max_output_tokens: null } }),
    ).toBeNull()
  })

  test("LiteLLM's /model/info gives windows by the public model name, only where they are written in", () => {
    expect(
      BuffProviderFile.infoWindows({
        data: [
          { model_name: "glm", model_info: { max_input_tokens: 1_000_000, max_output_tokens: 32_000 } },
          { model_name: "bare", model_info: { max_input_tokens: null } },
          { model_info: { max_input_tokens: 5 } },
        ],
      }),
    ).toEqual({ glm: { context: 1_000_000, output: 32_000 } })
    expect(BuffProviderFile.infoWindows("RBAC: access denied")).toEqual({})
  })
})
