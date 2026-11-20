import { LLM } from "@opencode/ai"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { QwenPlugin } from "@opencode/core/plugin/provider/qwen"
import { Provider } from "@opencode/core/provider"
import { expect } from "bun:test"
import { Clock, Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("qwen")
const providerID = Provider.ID.make("qwen")
const methodID = Integration.MethodID.make("device")
const tokenURL = "https://auth.qwen.ai/api/oauth/token"

const device = {
  device_code: "device-secret",
  user_code: "ABCD-EFGH",
  verification_uri: "https://chat.qwen.ai/device",
  verification_uri_complete: "https://chat.qwen.ai/device?user_code=ABCD-EFGH",
  expires_in: 600,
  interval: 5,
}
const tokens = (suffix: string) => ({
  access_token: `access-${suffix}`,
  refresh_token: `refresh-${suffix}`,
  token_type: "Bearer",
  expires_in: 900,
  scope: "model:invoke profile:read",
})
const pending = () => Response.json({ error: "authorization_pending" }, { status: 400 })

const fixture = Effect.gen(function* () {
  const requests: Request[] = []
  const replies: Response[] = []
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      requests.push(yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie))
      const response = replies.shift()
      if (!response) throw new Error(`Unexpected request: ${request.url}`)
      return HttpClientResponse.fromWeb(request, response)
    }),
  )
  const integrations = yield* Integration.Service
  const credentials = yield* Credential.Service
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* QwenPlugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
  const form = (request: Request) =>
    Effect.promise(() => request.text()).pipe(Effect.map((body) => Object.fromEntries(new URLSearchParams(body))))
  const status = (attemptID: Integration.AttemptID) => integrations.oauth.status({ integrationID, attemptID })
  const connect = integrations.oauth.connect({ integrationID, methodID, label: "Qwen" })
  const stored = (suffix: string, expires: number) =>
    credentials.create({
      integrationID,
      value: Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: `access-${suffix}`,
        refresh: `refresh-${suffix}`,
        expires,
      }),
    })
  return { requests, replies, http, integrations, credentials, form, status, connect, stored }
})

it.effect("registers the Qwen subscription login and its models without fetching", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    expect(ProviderPlugins).toContain(QwenPlugin)
    const integration = yield* test.integrations.get(integrationID)
    expect(integration?.name).toBe("Qwen")
    expect(integration?.methods).toEqual([{ id: methodID, type: "oauth", label: "Qwen Plus/Pro" }])

    // Without a signed-in account the models stay out of the picker.
    const models = yield* Model.Service
    expect((yield* models.available()).filter((model) => model.providerID === providerID)).toEqual([])

    yield* test.stored("one", (yield* Clock.currentTimeMillis) + 900_000)
    const provider = yield* (yield* Provider.Service).get(providerID)
    expect(provider?.name).toBe("Qwen")
    expect(provider?.package).toBe("@opencode/ai/providers/alibaba/chat")
    expect(provider?.settings?.baseURL).toBe("https://api.qwen.ai/compatible-mode/v1")

    const available = (yield* models.available()).filter((model) => model.providerID === providerID)
    expect(available.map((model) => String(model.id)).toSorted()).toEqual(["qwen3.8-flash", "qwen3.8-max", "qwen4-max"])
    for (const model of available) {
      // The subscription covers usage.
      expect(model.cost).toEqual([])
      expect(model.capabilities).toEqual({ tools: true, input: ["text", "image", "video"], output: ["text"] })
      expect(model.limit.context).toBe(1_000_000)
      expect(model.compatibility?.reasoningField).toBe("reasoning_content")
      expect(model.variants.map((variant) => String(variant.id))).toEqual(["none", "low", "medium", "xhigh"])
    }
    expect(test.requests).toHaveLength(0)
  }),
)

it.effect("signs in with a device code, honours the server's polling pace and calls the model", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    test.replies.push(Response.json(device))
    const attempt = yield* test.connect
    expect(attempt.url).toBe(device.verification_uri_complete)
    expect(attempt.instructions).toContain("ABCD-EFGH")
    expect(test.requests[0].url).toBe("https://auth.qwen.ai/api/oauth/device/code")
    expect(test.requests[0].method).toBe("POST")
    expect(yield* test.form(test.requests[0])).toEqual({
      client_id: "qwen-code-cli",
      scope: "model:invoke profile:read",
    })

    // Nothing is polled before the first interval has passed.
    yield* TestClock.adjust("4 seconds")
    expect(test.requests).toHaveLength(1)

    test.replies.push(pending())
    yield* TestClock.adjust("2 seconds")
    expect(test.requests).toHaveLength(2)
    expect(test.requests[1].url).toBe(tokenURL)
    expect(yield* test.form(test.requests[1])).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: "qwen-code-cli",
      device_code: "device-secret",
    })

    test.replies.push(
      Response.json({ error: "slow_down", error_description: "Polling too fast, use interval 20s" }, { status: 400 }),
    )
    yield* TestClock.adjust("6 seconds")
    expect(test.requests).toHaveLength(3)

    // The server named 20 seconds: an earlier poll would only push the pause further out.
    yield* TestClock.adjust("19 seconds")
    expect(test.requests).toHaveLength(3)
    expect((yield* test.status(attempt.attemptID)).status).toBe("pending")

    const now = yield* Clock.currentTimeMillis
    test.replies.push(Response.json(tokens("one")))
    yield* TestClock.adjust("2 seconds")
    expect(test.requests).toHaveLength(4)
    expect((yield* test.status(attempt.attemptID)).status).toBe("complete")

    const saved = (yield* test.credentials.list(integrationID))[0]?.value
    if (saved?.type !== "oauth") throw new Error("Expected OAuth credential")
    expect(saved.methodID).toBe(methodID)
    expect(saved.access).toBe("access-one")
    expect(saved.refresh).toBe("refresh-one")
    expect(saved.expires).toBeGreaterThanOrEqual(now + 900_000)
    expect(saved.metadata).toBeUndefined()

    test.replies.push(
      new Response(
        'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    )
    const events = yield* Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      const resolved = yield* resolver.resolve(Model.Ref.make({ providerID, id: Model.ID.make("qwen3.8-max") }))
      if (!resolved) throw new Error("Expected Qwen model")
      expect(resolved.model.route.id).toBe("alibaba-chat")
      return yield* LLMClient.stream(LLM.request({ model: resolved.model, prompt: "Hello" })).pipe(
        Stream.runCollect,
        Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer), Layer.fresh)),
        Effect.provideService(HttpClient.HttpClient, test.http),
      )
    }).pipe(Effect.provide(ModelResolver.layer))
    expect(events).toContainEqual(expect.objectContaining({ type: "text-delta", text: "Hello" }))
    expect(test.requests[4].url).toBe("https://api.qwen.ai/compatible-mode/v1/chat/completions")
    expect(test.requests[4].headers.get("authorization")).toBe("Bearer access-one")
  }),
)

for (const failure of [
  { body: { error: "access_denied" }, message: "Qwen sign-in was denied" },
  { body: { error: "expired_token" }, message: "Qwen sign-in code expired. Sign in again." },
  {
    body: { error: "invalid_client", error_description: "unknown client" },
    message: "Qwen sign-in failed (400): unknown client",
  },
]) {
  it.effect(`fails the attempt and stores nothing on ${failure.body.error}`, () =>
    Effect.gen(function* () {
      const test = yield* fixture
      test.replies.push(Response.json(device))
      const attempt = yield* test.connect
      test.replies.push(Response.json(failure.body, { status: 400 }))
      yield* TestClock.adjust("6 seconds")
      expect(yield* test.status(attempt.attemptID)).toMatchObject({ status: "failed", message: failure.message })
      expect(yield* test.credentials.list(integrationID)).toEqual([])
    }),
  )
}

it.effect("stops polling once the device code has expired", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    test.replies.push(Response.json({ ...device, expires_in: 8 }))
    const attempt = yield* test.connect
    test.replies.push(pending())
    yield* TestClock.adjust("20 seconds")
    expect(test.requests).toHaveLength(2)
    expect(yield* test.status(attempt.attemptID)).toMatchObject({
      status: "failed",
      message: "Qwen sign-in code expired. Sign in again.",
    })
  }),
)

it.effect("refreshes a short-lived token and keeps the rotated refresh token", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    const now = yield* Clock.currentTimeMillis
    const saved = yield* test.stored("one", now + 60_000)
    const connection = { type: "credential" as const, id: saved.id, label: saved.label }
    test.replies.push(Response.json(tokens("two")))

    const value = yield* test.integrations.connection.resolve(connection)
    expect(value).toMatchObject({ type: "oauth", methodID, access: "access-two", refresh: "refresh-two" })
    expect(test.requests[0].url).toBe(tokenURL)
    expect(yield* test.form(test.requests[0])).toEqual({
      grant_type: "refresh_token",
      client_id: "qwen-code-cli",
      refresh_token: "refresh-one",
    })
    const stored = (yield* test.credentials.get(saved.id))?.value
    expect(stored).toMatchObject({ access: "access-two", refresh: "refresh-two", expires: now + 900_000 })
  }),
)

it.effect("spends a rotating refresh token once when two requests refresh together", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    const saved = yield* test.stored("one", (yield* Clock.currentTimeMillis) + 60_000)
    const connection = { type: "credential" as const, id: saved.id, label: saved.label }
    test.replies.push(Response.json(tokens("two")))

    const values = yield* Effect.all(
      [test.integrations.connection.resolve(connection), test.integrations.connection.resolve(connection)],
      { concurrency: "unbounded" },
    )
    expect(test.requests).toHaveLength(1)
    expect(values.map((value) => (value?.type === "oauth" ? value.access : undefined))).toEqual([
      "access-two",
      "access-two",
    ])
  }),
)

it.effect("reports a rejected refresh so the person signs in again", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    const saved = yield* test.stored("one", (yield* Clock.currentTimeMillis) + 60_000)
    test.replies.push(
      Response.json({ error: "invalid_grant", error_description: "refresh token revoked" }, { status: 400 }),
    )
    const error = yield* test.integrations.connection
      .resolve({ type: "credential" as const, id: saved.id, label: saved.label })
      .pipe(Effect.flip)
    expect(error.message).toBe("Qwen sign-in failed (400): refresh token revoked")
  }),
)
