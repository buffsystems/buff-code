import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Clock, Effect, Option, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { App } from "../../app.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { Variant } from "../../variant.js"

// Sign-in with a Qwen account that carries a Plus or Pro plan from chat.qwen.ai (autonomous-dev/cloud-front#942).
// The flow and its constants are the ones Qwen Code uses for "Qwen Account with Subscription".
const integrationID = Integration.ID.make("qwen")
const providerID = Provider.ID.make("qwen")
const methodID = Integration.MethodID.make("device")
const issuer = "https://auth.qwen.ai/api/oauth"
const clientID = "qwen-code-cli"
const scope = "model:invoke profile:read"
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code"
const baseURL = "https://api.qwen.ai/compatible-mode/v1"
const packageID = "@opencode/ai/providers/alibaba/chat"
// The server lengthens the pause after every poll that arrives early, so stay clear of the boundary.
const pollingMargin = 1000

const MODELS = [
  { id: "qwen4-max", name: "Qwen4 Max", released: "2026-10-26" },
  { id: "qwen3.8-max", name: "Qwen3.8 Max", released: "2026-08-03" },
  { id: "qwen3.8-flash", name: "Qwen3.8 Flash", released: "2026-08-26" },
]

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
})
type Token = typeof Token.Type

const Device = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  interval: Schema.Number,
})
type Device = typeof Device.Type

const Failure = Schema.Struct({
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
})
const decodeFailure = Schema.decodeUnknownOption(Schema.fromJsonString(Failure))

type Reply = { readonly status: number; readonly body: string }

export const QwenPlugin = define({
  id: "opencode.provider.qwen",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    const post = (path: string, form: Record<string, string>): Effect.Effect<Reply, Error> =>
      http
        .execute(
          HttpClientRequest.post(`${issuer}/${path}`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)),
            HttpClientRequest.bodyUrlParams(form),
          ),
        )
        .pipe(
          Effect.flatMap((response) => response.text.pipe(Effect.map((body) => ({ status: response.status, body })))),
          Effect.mapError(() => new Error("Qwen sign-in request failed")),
        )

    // Refresh tokens rotate: a second refresh with the already spent one would sign the person out.
    const refreshing = Semaphore.makeUnsafe(1)
    let rotated: { readonly spent: string; readonly value: Credential.OAuth } | undefined
    const refresh = (value: Credential.OAuth) =>
      refreshing.withPermit(
        Effect.gen(function* () {
          if (rotated?.spent === value.refresh) return rotated.value
          const reply = yield* post("token", {
            grant_type: "refresh_token",
            client_id: clientID,
            refresh_token: value.refresh,
          })
          const next = yield* credential(yield* decode(reply, Token))
          rotated = { spent: value.refresh, value: next }
          return next
        }),
      )

    const poll = (device: Device, expires: number) => {
      const loop = (interval: number): Effect.Effect<Token, Error> =>
        Effect.gen(function* () {
          yield* Effect.sleep(interval + pollingMargin)
          if ((yield* Clock.currentTimeMillis) >= expires) return yield* Effect.fail(failure(400, "expired_token"))
          const reply = yield* post("token", {
            grant_type: deviceGrant,
            client_id: clientID,
            device_code: device.device_code,
          })
          if (reply.status >= 200 && reply.status < 300) return yield* decode(reply, Token)
          const error = Option.getOrUndefined(decodeFailure(reply.body))
          if (error?.error === "authorization_pending") return yield* loop(interval)
          if (error?.error === "slow_down") return yield* loop(slowedInterval(interval, error.error_description))
          return yield* Effect.fail(failure(reply.status, error?.error, error?.error_description))
        })
      return loop(device.interval * 1000)
    }

    const method = {
      integrationID,
      method: { id: methodID, type: "oauth", label: "Qwen Plus/Pro" },
      authorize: () =>
        Effect.gen(function* () {
          const device = yield* decode(yield* post("device/code", { client_id: clientID, scope }), Device)
          const expires = (yield* Clock.currentTimeMillis) + device.expires_in * 1000
          return {
            mode: "auto" as const,
            url: device.verification_uri_complete ?? device.verification_uri,
            instructions: `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`,
            expiresAt: expires,
            callback: poll(device, expires).pipe(Effect.flatMap(credential)),
          }
        }),
      refresh,
    } satisfies IntegrationOAuthMethodRegistration

    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = "Qwen"
      })
      editor.method.update(method)
    })
    yield* ctx.provider.transform((providers) => {
      providers.update(providerID, (provider) => {
        provider.name = "Qwen"
        provider.package = packageID
        provider.settings = Provider.mergeOverlay(provider.settings, { baseURL })
      })
      for (const item of MODELS) {
        providers.models.update(providerID, Model.ID.make(item.id), (model) => {
          model.name = item.name
          model.family = Model.Family.make("qwen")
          model.compatibility = { reasoningField: "reasoning_content" }
          model.capabilities = { tools: true, input: ["text", "image", "video"], output: ["text"] }
          model.time = { released: Date.parse(item.released) }
          // The subscription covers usage.
          model.cost = []
          model.limit = { context: 1_000_000, output: 131_072 }
          model.variants = [
            ...Variant.resolve({ ...model, package: packageID }, [
              { type: "toggle" },
              { type: "effort", values: ["low", "medium", "xhigh"] },
            ]),
          ]
        })
      }
    })
  }),
})

function credential(tokens: Token) {
  return Clock.currentTimeMillis.pipe(
    Effect.map((now) =>
      Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: tokens.access_token,
        refresh: tokens.refresh_token,
        expires: now + tokens.expires_in * 1000,
      }),
    ),
  )
}

function decode<S extends Schema.Decoder<unknown>>(reply: Reply, schema: S) {
  if (reply.status < 200 || reply.status >= 300) {
    const error = Option.getOrUndefined(decodeFailure(reply.body))
    return Effect.fail(failure(reply.status, error?.error, error?.error_description))
  }
  return Option.match(Schema.decodeUnknownOption(Schema.fromJsonString(schema))(reply.body), {
    onNone: () => Effect.fail(new Error(`Qwen sign-in failed (${reply.status}): unexpected response`)),
    onSome: (value) => Effect.succeed(value),
  })
}

function failure(status: number, code?: string, description?: string) {
  if (code === "access_denied" || code === "authorization_denied") return new Error("Qwen sign-in was denied")
  if (code === "expired_token") return new Error("Qwen sign-in code expired. Sign in again.")
  const detail = description ?? code
  return new Error(`Qwen sign-in failed (${status})${detail ? `: ${detail}` : ""}`)
}

/** The pause the server asks for ("use interval 20s"), else the RFC 8628 step of five more seconds. */
function slowedInterval(current: number, description?: string) {
  const named = Number(/interval (\d+)\s*s/.exec(description ?? "")?.[1])
  return Number.isFinite(named) && named > 0 ? named * 1000 : current + 5000
}
