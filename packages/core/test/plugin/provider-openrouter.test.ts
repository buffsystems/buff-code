import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { OpenRouterPlugin } from "@opencode/core/plugin/provider/openrouter"
import { Provider } from "@opencode/core/provider"
import { drain } from "../lib/clock"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const remote = { body: { data: [] } as unknown, requests: [] as HttpClientRequest.HttpClientRequest[] }
const http = HttpClient.make((request) =>
  Effect.sync(() => {
    remote.requests.push(request)
    return HttpClientResponse.fromWeb(request, Response.json(remote.body))
  }),
)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* OpenRouterPlugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
})

const openrouter = Effect.fn(function* () {
  const catalog = yield* Provider.Service
  yield* catalog.transform((catalog) => {
    catalog.update(Provider.ID.openrouter, (provider) => {
      provider.package = "@opencode/ai/providers/openrouter"
    })
    catalog.models.update(Provider.ID.openrouter, Model.ID.make("deepseek/deepseek-v4.1-flash"), (model) => {
      model.name = "Snapshot name"
    })
  })
})

const LIVE = {
  data: [
    {
      id: "deepseek/deepseek-v4.1-flash-1017",
      name: "DeepSeek: V4.1 Flash (1017)",
      created: 1_792_000_000,
      context_length: 1_048_576,
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      pricing: { prompt: "0.0000001", completion: "0.0000004", input_cache_read: "0.00000001" },
      top_provider: { max_completion_tokens: 65_536 },
      supported_parameters: ["tools", "reasoning"],
    },
    {
      id: "google/gemini-3.1-flash-lite-image",
      name: "Gemini 3.1 Flash Lite Image",
      architecture: { input_modalities: ["text", "image"], output_modalities: ["image", "text"] },
      pricing: { prompt: "0.0000001", completion: "0.0000004" },
    },
    { id: "deepseek/deepseek-v4.1-flash", name: "Live name" },
  ],
}

describe("OpenRouterPlugin", () => {
  test("is registered so legacy OpenRouter behavior can be applied", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.openrouter")
  })

  it.effect("introduces itself to OpenRouter as Buff Code, and only there", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openrouter, (provider) => {
          provider.package = "@opencode/ai/providers/openrouter"
          provider.headers = { Existing: "value" }
        })
        catalog.update(Provider.ID.make("nvidia"), () => {})
      })
      yield* addPlugin()

      expect((yield* catalog.get(Provider.ID.openrouter))?.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://buff.systems/",
        "X-Title": "Buff Code",
      })
      expect((yield* catalog.get(Provider.ID.make("nvidia")))?.headers).toBeUndefined()
    }),
  )

  it.effect("filters OpenRouter's gpt-5 chat alias", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openrouter, (provider) => {
          provider.package = "@opencode/ai/providers/openrouter"
        })
        catalog.update(Provider.ID.openai, () => {})
        catalog.models.update(Provider.ID.openrouter, Model.ID.make("openai/gpt-5-chat"), () => {})
        catalog.models.update(Provider.ID.openrouter, Model.ID.make("openai/gpt-5"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("openai/gpt-5-chat"), () => {})
      })
      yield* addPlugin()

      expect((yield* models.get(Provider.ID.openrouter, Model.ID.make("openai/gpt-5-chat")))?.enabled).toBe(false)
      expect((yield* models.get(Provider.ID.openrouter, Model.ID.make("openai/gpt-5")))?.enabled).toBe(true)
      expect((yield* models.get(Provider.ID.openai, Model.ID.make("openai/gpt-5-chat")))?.enabled).toBe(true)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-OpenRouter providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("custom-openrouter"), () => {})
        catalog.models.update(Provider.ID.make("custom-openrouter"), Model.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        (yield* models.get(Provider.ID.make("custom-openrouter"), Model.ID.make("gpt-5-chat-latest")))?.enabled,
      ).toBe(true)
    }),
  )

  it.effect("adds the models OpenRouter lists that the bundled catalogue lacks (#27)", () =>
    Effect.gen(function* () {
      remote.body = LIVE
      remote.requests = []
      yield* openrouter()
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openrouter"),
        value: Credential.Key.make({ type: "key", key: "or-key" }),
      })
      yield* addPlugin()
      yield* drain
      const models = yield* Model.Service

      expect(remote.requests[0]).toMatchObject({ method: "GET", url: "https://openrouter.ai/api/v1/models" })
      expect(
        yield* models.get(Provider.ID.openrouter, Model.ID.make("deepseek/deepseek-v4.1-flash-1017")),
      ).toMatchObject({
        name: "DeepSeek: V4.1 Flash (1017)",
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        limit: { context: 1_048_576, output: 65_536 },
        time: { released: 1_792_000_000_000 },
      })
      const cost = (yield* models.get(Provider.ID.openrouter, Model.ID.make("deepseek/deepseek-v4.1-flash-1017")))
        ?.cost[0]
      expect(cost?.input).toBeCloseTo(0.1)
      expect(cost?.output).toBeCloseTo(0.4)
      expect(cost?.cache.read).toBeCloseTo(0.01)
      expect(
        yield* models.get(Provider.ID.openrouter, Model.ID.make("google/gemini-3.1-flash-lite-image")),
      ).toMatchObject({
        capabilities: { tools: false, input: ["text", "image"], output: ["text", "image"] },
      })
      // A model the catalogue knows keeps the catalogue's richer entry.
      expect((yield* models.get(Provider.ID.openrouter, Model.ID.make("deepseek/deepseek-v4.1-flash")))?.name).toBe(
        "Snapshot name",
      )
    }),
  )

  it.effect("does not ask OpenRouter while it is not connected", () =>
    Effect.gen(function* () {
      remote.body = LIVE
      remote.requests = []
      yield* openrouter()
      yield* addPlugin()
      yield* drain
      const models = yield* Model.Service
      expect(remote.requests).toHaveLength(0)
      expect(
        yield* models.get(Provider.ID.openrouter, Model.ID.make("deepseek/deepseek-v4.1-flash-1017")),
      ).toBeUndefined()
    }),
  )
})
