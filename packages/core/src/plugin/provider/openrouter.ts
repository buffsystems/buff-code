import { Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Money } from "@opencode/schema/money"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Model } from "../../model.js"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffBrand } from "../../buff/brand.js"

const PACKAGE = "@opencode/ai/providers/openrouter"
const integrationID = "openrouter"
const endpoint = "https://openrouter.ai/api/v1/models"

/** One entry of OpenRouter's live list: prices are USD per token, as strings. */
const Listed = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  created: Schema.optional(Schema.Number),
  context_length: Schema.optional(Schema.NullOr(Schema.Number)),
  architecture: Schema.optional(
    Schema.Struct({
      input_modalities: Schema.optional(Schema.Array(Schema.String)),
      output_modalities: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  pricing: Schema.optional(
    Schema.Struct({
      prompt: Schema.optional(Schema.String),
      completion: Schema.optional(Schema.String),
      input_cache_read: Schema.optional(Schema.String),
      input_cache_write: Schema.optional(Schema.String),
    }),
  ),
  top_provider: Schema.optional(
    Schema.Struct({ max_completion_tokens: Schema.optional(Schema.NullOr(Schema.Number)) }),
  ),
  supported_parameters: Schema.optional(Schema.Array(Schema.String)),
})
type Listed = typeof Listed.Type
const ListResponse = Schema.Struct({ data: Schema.Array(Listed) })

const perMillion = (perToken: string | undefined) => {
  const value = Number(perToken ?? 0) * 1_000_000
  return Money.USDPerMillionTokens.make(Number.isFinite(value) && value > 0 ? value : 0)
}

/** A model OpenRouter lists but the bundled catalogue does not know yet, as the catalogue would hold it. */
export function listedModel(item: Listed, draft: Model.MutableInfo) {
  const input = item.architecture?.input_modalities ?? ["text"]
  const output = item.architecture?.output_modalities ?? ["text"]
  draft.name = item.name || item.id
  draft.capabilities = {
    tools: item.supported_parameters?.includes("tools") ?? false,
    input: ["text", ...input.filter((kind) => kind === "image")],
    output: ["text", ...output.filter((kind) => kind === "image")],
  }
  if (item.context_length) draft.limit.context = item.context_length
  if (item.top_provider?.max_completion_tokens) draft.limit.output = item.top_provider.max_completion_tokens
  if (item.created) draft.time.released = item.created * 1000
  draft.cost = [
    {
      input: perMillion(item.pricing?.prompt),
      output: perMillion(item.pricing?.completion),
      cache: { read: perMillion(item.pricing?.input_cache_read), write: perMillion(item.pricing?.input_cache_write) },
    },
  ]
}

export const OpenRouterPlugin = define({
  id: "opencode.provider.openrouter",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const loading = Semaphore.makeUnsafe(1)
    // The live list (#27): the bundled catalogue is a snapshot, OpenRouter adds models every week.
    // Asked only while OpenRouter is connected — then the person talks to it anyway.
    const loaded: { models: readonly Listed[] } = { models: [] }

    const load = Effect.fn("OpenRouterPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      if (!connection) {
        loaded.models = []
        return
      }
      const result = yield* http
        .execute(
          HttpClientRequest.get(endpoint).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)),
          ),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(ListResponse)),
          Effect.timeout("15 seconds"),
          Effect.catch((cause) =>
            Effect.logWarning("failed to list OpenRouter models", { cause }).pipe(Effect.as(undefined)),
          ),
        )
      if (result) loaded.models = result.data
    })

    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (item.provider.package !== PACKAGE) continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = {
            ...provider.headers,
            "HTTP-Referer": BuffBrand.ATTRIBUTION.referer,
            "X-Title": BuffBrand.ATTRIBUTION.title,
          }
        })
        for (const listed of loaded.models) {
          if (item.models.has(Model.ID.make(listed.id))) continue
          evt.models.update(item.provider.id, listed.id, (draft) => listedModel(listed, draft))
        }
      }
    })
    yield* ctx.model.transform((models) => {
      for (const item of models.provider.list()) {
        if (item.provider.package !== PACKAGE) continue
        for (const modelID of [Model.ID.make("gpt-5-chat-latest"), Model.ID.make("openai/gpt-5-chat")]) {
          if (!models.get(item.provider.id, modelID)) continue
          models.update(item.provider.id, modelID, (model) => {
            // These are OpenRouter-specific OpenAI chat aliases that do not work
            // on the generic path. Keep custom providers with matching IDs untouched.
            model.enabled = false
          })
        }
      }
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    // The last good list stays through a failed refresh.
    yield* refresh().pipe(Effect.repeat(Schedule.spaced("1 hour")), Effect.forkScoped)
  }),
})
