export * as BuffModels from "./models.js"

import { Effect, Option, Stream } from "effect"
import type { Scope } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { BuffContext } from "@opencode/schema/buff-context"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Integration } from "../integration.js"
import { Model } from "../model.js"
import { Provider } from "../provider.js"

/**
 * Модели организации в Buff Code (#370). Провайдер «Buff» — OpenAI-совместимая дверь шлюза
 * коннектора компании: модель выбрал администратор организации, ключ провайдера и расчёт —
 * на стороне Buff, а здесь только токен разработчика (#366). Организация и проект рабочего
 * контекста (#391) едут заголовками каждого запроса — за них и списывается расход.
 */

export const providerID = Provider.ID.make("buff")
const integrationID = Integration.ID.make("buff")
const FIRST_LOAD = "3 seconds"

/** Вход, через который зовутся модели: токен разработчика и адрес коннектора. */
export type SignedIn = { readonly token: string; readonly connector: string }

export interface Deps {
  readonly signedIn: Effect.Effect<SignedIn | undefined>
  readonly choice: Effect.Effect<BuffContext.Choice | null>
}

/** Заголовки рабочего контекста: по ним бэкенд берёт маршрут организации и пишет расход. */
export function contextHeaders(choice: BuffContext.Choice | null): Record<string, string> {
  if (!choice) return {}
  return { "X-Buff-Org": choice.org, ...(choice.project ? { "X-Buff-Project": choice.project } : {}) }
}

/** Заголовки вызова модели: рабочий контекст, сессия, в которой бэкенд хранит ход (#369),
 *  сообщение-ответ, под которым кабинет покажет ход (#439; у служебных вызовов его нет), и
 *  вид вызова — работа или служебный (заголовок, сжатие): кабинет прячет служебные (#373). */
export function requestHeaders(
  choice: BuffContext.Choice | null,
  sessionID: string,
  kind: string,
  messageID?: string,
): Record<string, string> {
  return {
    ...contextHeaders(choice),
    "X-Buff-Session": sessionID,
    ...(messageID ? { "X-Buff-Message": messageID } : {}),
    "X-Buff-Call": kind,
  }
}

/** Модель из списка коннектора: идентификатор и имя, под которым её показывать. */
export type Listed = { readonly id: string; readonly name: string }

/** Ответ /v1/models → модели. Имя даёт бэкенд (#435): для нашей модели это тариф, сама
 *  модель — только там, где её выбрала организация. Без имени показывается идентификатор. */
export function listedModels(reply: unknown): Listed[] {
  const data = (reply as { data?: unknown } | null)?.data
  return (Array.isArray(data) ? data : []).flatMap((item) => {
    const { id, name } = (item ?? {}) as { id?: unknown; name?: unknown }
    if (typeof id !== "string" || !id) return []
    return [{ id, name: typeof name === "string" && name ? name : id }]
  })
}

/** Регистрирует провайдера; возвращает перезагрузку списка — её зовут при смене контекста. */
export const register = Effect.fn("BuffModels.register")(function* (
  ctx: Context,
  http: HttpClient.HttpClient,
  deps: Deps,
) {
  const loaded: { connector?: string; models: Listed[]; at: number } = { models: [], at: 0 }

  const load = Effect.gen(function* () {
    const me = yield* deps.signedIn
    const choice = yield* deps.choice
    if (!me || !choice) {
      loaded.connector = undefined
      loaded.models = []
      return
    }
    const response = yield* HttpClientRequest.get(`${me.connector}/v1/models`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(me.token),
      HttpClientRequest.setHeaders(contextHeaders(choice)),
      (request) => http.execute(request),
    )
    const reply = yield* response.json
    if (response.status >= 400) return yield* Effect.fail(new Error(`connector answered ${response.status}`))
    loaded.connector = me.connector
    loaded.models = listedModels(reply)
    loaded.at = Date.now()
  }).pipe(
    // Сбой сети не гасит уже известные модели: список обновится при следующей смене.
    Effect.catch((cause) => Effect.logWarning("Buff: the model list is unavailable", { cause })),
  )

  yield* ctx.provider.transform((providers) => {
    const connector = loaded.connector
    if (!connector || loaded.models.length === 0) return
    providers.update(providerID, (provider) => {
      provider.name = "Buff"
      provider.activation = "auto"
      provider.integrationID = integrationID
      provider.package = "@opencode/ai/providers/openai-compatible"
      provider.settings = { baseURL: `${connector}/v1`, provider: "buff" }
    })
    for (const { id, name } of loaded.models) {
      providers.models.update(providerID, id, (model) => {
        model.modelID = Model.ID.make(id)
        model.name = name
        model.capabilities = { tools: true, input: ["text"], output: ["text"] }
        // Модель организации актуальна по определению — её выбрал администратор. Выбор
        // моделей в десктопе показывает только последнюю модель своего семейства за полгода:
        // без даты она читается как 1970 год, без семейства не считается ничьей последней.
        model.time = { released: loaded.at }
        model.family = Model.Family.make(id)
      })
    }
  })

  // Контекст читается в момент запроса: смена проекта действует со следующего сообщения.
  yield* ctx.session.hook(
    "model.request",
    (evt) =>
      Effect.gen(function* () {
        if (evt.model.providerID !== providerID) return
        Object.assign(evt.headers, requestHeaders(yield* deps.choice, evt.sessionID, evt.kind, evt.messageID))
      }),
    { providerID },
  )

  const reload = load.pipe(Effect.andThen(ctx.provider.reload()))
  yield* ctx.event.subscribe().pipe(
    Stream.filter(
      (event) =>
        event.type === "credential.switched" &&
        (event.data as { integrationID?: string } | undefined)?.integrationID === integrationID,
    ),
    Stream.runForEach(() => reload),
    Effect.forkScoped({ startImmediately: true }),
  )
  // Первый список — до готовности: консольная команда спрашивает модели сразу после старта.
  // Молчащий коннектор не держит запуск дольше нескольких секунд — дальше список догоняет фоном.
  const first = yield* reload.pipe(Effect.timeoutOption(FIRST_LOAD))
  if (Option.isNone(first)) yield* reload.pipe(Effect.forkScoped)
  return reload
}) satisfies (...args: never[]) => Effect.Effect<Effect.Effect<void>, never, Scope.Scope>
