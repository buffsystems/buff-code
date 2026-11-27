import { expect } from "bun:test"
import { LanguageModel, LLMClient } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { AISDK } from "@opencode/core/aisdk"
import { BuffProviderFetch } from "@opencode/core/buff/provider-fetch"
import { Generate } from "@opencode/core/generate"
import { Integration } from "@opencode/core/integration"
import { ModelResolver } from "@opencode/core/model-resolver"
import { ID, Info, Model, Ref } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Npm } from "@opencode/util/npm"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { testEffect } from "./lib/effect"

const selected = Info.make({
  ...Info.default(Provider.ID.make("test-provider"), ID.make("gemini")),
  package: Provider.aisdk("@ai-sdk/cohere"),
})
const runtime = LanguageModel.make({ id: "gemini", provider: "test-provider", route: OpenAIChat.route })

const providers = Layer.mock(Provider.Service, {
  get: () => Effect.undefined,
})
const models = Layer.mock(Model.Service, {
  get: () => Effect.succeed(selected),
})
const integrations = Layer.mock(Integration.Service, {
  revision: () => 0,
  connection: {
    active: () => Effect.undefined,
    resolve: () => Effect.die("unused"),
    key: () => Effect.die("unused"),
    activate: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
  },
  oauth: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    complete: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
  command: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
})
const npm = Layer.mock(Npm.Service, {
  add: () => Effect.die("unused"),
  which: () => Effect.die("unused"),
})
const aisdk = Layer.mock(AISDK.Service, {
  hook: {
    sdk: () => Effect.die("unused"),
    language: () => Effect.die("unused"),
  },
  model: () => Effect.succeed(runtime),
})
const client = TestLLM.testLayer({ fallback: TestLLM.text("OK", "generate") })

const resolver = ModelResolver.layer.pipe(Layer.provide(Layer.mergeAll(providers, models, integrations, npm, aisdk)))
const it = testEffect(Generate.layer.pipe(Layer.provide(Layer.merge(resolver, client))))
const resolverIt = testEffect(resolver)

it.effect("loads dynamic AI SDK models", () =>
  Effect.gen(function* () {
    const generate = yield* Generate.Service
    const result = yield* generate.text({
      prompt: "Return exactly OK",
      model: Ref.make({ providerID: selected.providerID, id: selected.id }),
    })

    expect(result).toBe("OK")
  }),
)

resolverIt.effect("resolves dynamic models with their catalog metadata", () =>
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const result = yield* resolver.resolve(Ref.make({ providerID: selected.providerID, id: selected.id }))

    expect(result).toEqual({
      model: runtime,
      ref: Ref.make({ providerID: selected.providerID, id: selected.id }),
      capabilities: selected.capabilities,
      cost: selected.cost,
      limit: selected.limit,
    })
  }),
)

// Buff (#966): a provider that answers its own requests is offered to the model layer as the transport.
const offered = Layer.mock(LLMClient.Service, {
  generate: (_request, options) =>
    options?.http
      ? options
          .http(HttpClientRequest.post("https://provider.invalid/v1/chat/completions"), () =>
            Effect.die("the network must not be reached"),
          )
          .pipe(
            Effect.flatMap((response) => response.text),
            Effect.map((text) => ({ text }) as never),
            Effect.orDie,
          )
      : Effect.die("no transport was offered"),
})
const answeringIt = testEffect(Generate.layer.pipe(Layer.provide(Layer.merge(resolver, offered))))

answeringIt.effect("a one-off generation goes to a provider that answers its own requests, not to the network", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => BuffProviderFetch.register(selected.providerID, async () => new Response("answered by the provider"))),
    () =>
      Effect.gen(function* () {
        const generate = yield* Generate.Service
        expect(
          yield* generate.text({ prompt: "x", model: Ref.make({ providerID: selected.providerID, id: selected.id }) }),
        ).toBe("answered by the provider")
      }),
    (remove) => Effect.sync(remove),
  ),
)
