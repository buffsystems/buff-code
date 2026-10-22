export * as BuffProviderPlugin from "./provider.js"

import { LLM, LLMClient } from "@opencode/ai"
import { parse } from "jsonc-parser"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffProvider } from "@opencode/schema/buff-provider"
import type { SessionError } from "@opencode/schema/session-error"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Config } from "../config.js"
import { Credential } from "../credential.js"
import { Integration } from "../integration.js"
import { Model } from "../model.js"
import { ModelResolver } from "../model-resolver.js"
import { Provider } from "../provider.js"
import { toSessionError } from "../session/to-session-error.js"
import type { PluginInternal } from "../plugin/internal.js"
import { BuffConfigFiles } from "./config-files.js"
import { BuffLocale } from "./locale.js"
import { BuffProviderFile } from "./provider-file.js"

/**
 * Свои OpenAI-совместимые провайдеры из интерфейса (#562). Запись — в файле конфигурации
 * пользователя: ядро само подхватывает изменённый файл и заводит провайдера с его моделями.
 * Ключ — в хранилище ключей под тем же провайдером, в файл он не попадает. Здесь же
 * проверка модели любого подключённого провайдера: короткий запрос и ответ или отказ.
 */

const { refuse } = BuffConfigFiles
const ModelList = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })
const PROMPT = "Reply with one word: OK"
const MAX_TOKENS = 1024

export interface Options {
  /** Каталог конфигурации пользователя — общий для всех проектов. */
  readonly userDirectory: string
  /** Сколько ждать, пока ядро перечитает файл и заведёт провайдера. */
  readonly settle: Duration.Input
  /** Сколько ждать ответа сервера моделей и проверочного запроса. */
  readonly timeout: Duration.Input
}

/** Отказ сервера по коду ответа — в тех же видах, что отказ хода. */
function httpFailure(status: number, message: string): SessionError.Error {
  const type =
    status === 401 || status === 403
      ? "provider.auth"
      : status === 402
        ? "provider.quota"
        : status === 429
          ? "provider.rate-limit"
          : status >= 500
            ? "provider.internal"
            : "provider.invalid-request"
  return { type, status, message }
}

/** Что сказал сервер: `error.message`, `error` строкой или начало тела. */
function said(body: string): string {
  const parsed: unknown = parse(body)
  if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
    const error = parsed.error
    if (typeof error === "string") return error
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string")
      return error.message
  }
  return body.trim().slice(0, 300)
}

export const register = Effect.fn("BuffProvider.register")(function* (ctx: Context, options: Options) {
  const integration = yield* Integration.Service
  const store = yield* Credential.Service
  const resolver = yield* ModelResolver.Service
  const llm = yield* LLMClient.Service
  const http = yield* HttpClient.HttpClient
  const { scopeOf, text, files, fileFor, rewrite } = BuffConfigFiles.make({
    config: yield* Config.Service,
    fs: yield* FSUtil.Service,
    dirs: { user: options.userDirectory, project: ctx.location.directory },
  })
  const userFiles = files.pipe(Effect.map((found) => found.filter((file) => scopeOf(file) === "user")))
  const credentials = (id: string) =>
    store.list(Integration.ID.make(id)).pipe(Effect.map((saved) => saved.map((credential) => credential.id)))

  /** Свои провайдеры одного файла; файл, который не читается, их не даёт — как и для ядра. */
  const ownIn = (file: string) =>
    text(file).pipe(
      Effect.flatMap((content) => Effect.try(() => BuffProviderFile.providers(content ?? ""))),
      Effect.orElseSucceed(() => []),
    )

  const list = Effect.gen(function* () {
    const found = new Map<string, Omit<BuffProvider.Entry, "hasKey">>()
    for (const file of yield* userFiles) for (const entry of yield* ownIn(file)) found.set(entry.id, entry)
    return yield* Effect.forEach([...found.values()], (entry) =>
      credentials(entry.id).pipe(Effect.map((saved): BuffProvider.Entry => ({ ...entry, hasKey: saved.length > 0 }))),
    )
  })

  /** Ключ сохранённого провайдера — чтобы при правке не вводить его заново. */
  const storedKey = Effect.fnUntraced(function* (id: string) {
    const active = yield* integration.connection.active(Integration.ID.make(id))
    const value = active
      ? yield* integration.connection.resolve(active).pipe(Effect.orElseSucceed(() => undefined))
      : undefined
    return value?.type === "key" ? value.key : undefined
  })

  const models = Effect.fnUntraced(function* (input: { baseURL: string; key?: string; id?: string }) {
    const baseURL = input.baseURL.trim().replace(/\/+$/, "")
    // Сохранённый ключ уходит только на адрес, записанный у этого провайдера.
    const saved = input.id ? (yield* list).find((entry) => entry.id === input.id) : undefined
    const key = input.key || (saved && saved.baseURL === baseURL ? yield* storedKey(saved.id) : undefined)
    const url = `${baseURL}/models`
    const request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.acceptJson,
      key ? HttpClientRequest.bearerToken(key) : (request) => request,
    )
    return yield* http.execute(request).pipe(
      Effect.timeout(options.timeout),
      Effect.flatMap((response) =>
        response.status >= 400
          ? response.text.pipe(
              Effect.orElseSucceed(() => ""),
              Effect.map((body): BuffProvider.Discovered => ({ error: httpFailure(response.status, said(body)) })),
            )
          : HttpClientResponse.schemaBodyJson(ModelList)(response).pipe(
              Effect.map(
                (body): BuffProvider.Discovered => ({
                  models: [...new Set(body.data.map((model) => model.id))].toSorted((a, b) => a.localeCompare(b)),
                }),
              ),
              Effect.orElseSucceed(
                (): BuffProvider.Discovered => ({
                  error: {
                    type: "provider.invalid-output",
                    message: BuffLocale.t("The server answered, but not with a list of models."),
                  },
                }),
              ),
            ),
      ),
      Effect.catch((cause) =>
        Effect.succeed<BuffProvider.Discovered>({
          error: { type: "provider.transport", message: cause instanceof Error ? cause.message : String(cause) },
        }),
      ),
    )
  })

  const save = Effect.fnUntraced(function* (draft: BuffProvider.Draft) {
    const problem = BuffProvider.draftProblem(draft, BuffLocale.t)
    if (problem) return yield* refuse("invalid", problem)
    // Провайдер остаётся в своём файле; новый — в файле пользователя, куда пишутся и MCP.
    const placed = yield* Effect.filter(yield* userFiles, (file) =>
      ownIn(file).pipe(Effect.map((own) => own.some((entry) => entry.id === draft.id))),
    )
    const file = placed.at(-1) ?? (yield* fileFor("user"))
    yield* rewrite(file, (before) => BuffProviderFile.withProvider(before, draft.id, draft))
    const key = draft.key?.trim()
    if (!key) return
    // Новый ключ заменяет прежний: он становится активным, прежние уходят.
    const previous = yield* credentials(draft.id)
    yield* store.create({
      integrationID: Integration.ID.make(draft.id),
      label: draft.name.trim(),
      value: Credential.Key.make({ type: "key", key }),
    })
    yield* Effect.forEach(previous, (id) => store.remove(id))
  })

  const remove = Effect.fnUntraced(function* (id: string) {
    for (const file of yield* userFiles)
      yield* rewrite(file, (before) => BuffProviderFile.withProvider(before, id, undefined))
    yield* Effect.forEach(yield* credentials(id), (credential) => store.remove(credential))
  })

  const test = Effect.fnUntraced(function* (input: { providerID: string; modelID: string }) {
    const started = Date.now()
    return yield* Effect.gen(function* () {
      const resolved = yield* resolver.resolve({
        providerID: Provider.ID.make(input.providerID),
        id: Model.ID.make(input.modelID),
      })
      if (!resolved)
        return {
          error: {
            type: "provider.no-route",
            message: BuffLocale.t("Model unavailable: {model}", { model: `${input.providerID}/${input.modelID}` }),
          },
        } satisfies BuffProvider.Checked
      // Короткий ответ: весь предел модели проверке не нужен, а ключ с малым лимитом получил бы 402.
      const response = yield* llm.generate(
        LLM.request({ model: resolved.model, prompt: PROMPT, generation: { maxTokens: MAX_TOKENS } }),
      )
      return { ms: Date.now() - started, text: response.text.trim() } satisfies BuffProvider.Checked
    }).pipe(
      Effect.timeoutOrElse({
        duration: options.timeout,
        orElse: () =>
          Effect.succeed<BuffProvider.Checked>({
            error: {
              type: "provider.transport",
              message: BuffLocale.t("No answer in {seconds} s", { seconds: Duration.toSeconds(options.timeout) }),
            },
          }),
      }),
      Effect.catch((cause) => Effect.succeed<BuffProvider.Checked>({ error: toSessionError(cause) })),
    )
  })

  let changed: Effect.Effect<void> = Effect.void
  const registration = yield* ctx.rpc
    .register(BuffProvider.Rpc, {
      list: () => list,
      models: (input) => models(input),
      save: (input, call) =>
        save(input).pipe(
          Effect.andThen(Effect.sleep(options.settle)),
          Effect.andThen(() => changed),
          Effect.as(undefined),
          Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {})),
        ),
      remove: (input, call) =>
        remove(input.id).pipe(
          Effect.andThen(Effect.sleep(options.settle)),
          Effect.andThen(() => changed),
          Effect.as(undefined),
          Effect.mapError((refusal) => call.error("unwritable", refusal.message, {})),
        ),
      test: (input) => test(input),
    })
    .pipe(Effect.orDie)
  changed = registration.events.emit("changed", {}).pipe(Effect.ignore)
})

export const Plugin = define({
  id: "buff.provider",
  // Ядро перечитывает изменённый файл с задержкой и затем заводит провайдера заново.
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx, { userDirectory: (yield* Global.Service).config, settle: "400 millis", timeout: "60 seconds" })
  }),
} satisfies PluginInternal.InternalPlugin)
