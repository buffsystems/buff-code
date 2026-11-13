export * as BuffModels from "./models.js"

import { Effect, Option, Stream } from "effect"
import type { Scope } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { BuffContext } from "@opencode/schema/buff-context"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { BuffContextWindow } from "@opencode/schema/buff-context-window"
import { BuffVariant } from "@opencode/schema/buff-variant"
import { Integration } from "../integration.js"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
import { Variant } from "../variant.js"

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

/** Модель из списка коннектора: идентификатор, имя, под которым её показывать, что она
 *  читает и пишет (#27) — картинку Buff Code отправляет только видящей модели; окно и потолок
 *  вывода, умеет ли думать, и дефолты организации для Buff Code (#838). */
export type Listed = {
  readonly id: string
  readonly name: string
  readonly input: readonly string[]
  readonly output: readonly string[]
  readonly limit: { readonly context?: number; readonly output?: number }
  readonly reasoning: boolean
  readonly defaults: { readonly thinking?: string; readonly contextTokens?: number }
}

/** Уровни мышления, которые предлагает думающая модель организации — общий словарь Buff. */
const LEVELS = BuffVariant.LEVELS.filter((level) => level !== "default")

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

/** Модальности из списка, как их пишет OpenRouter; текст есть всегда, о чём не сказано — нет. */
function modalities(value: unknown): string[] {
  const said = Array.isArray(value) ? value.filter((m): m is string => typeof m === "string" && m !== "") : []
  return ["text", ...said.filter((m) => m !== "text")]
}

/** Ответ /v1/models → модели. Имя даёт бэкенд (#435): для нашей модели это тариф, сама
 *  модель — только там, где её выбрала организация. Без имени показывается идентификатор. */
export function listedModels(reply: unknown): Listed[] {
  const data = (reply as { data?: unknown } | null)?.data
  return (Array.isArray(data) ? data : []).flatMap((item) => {
    const { id, name, input_modalities, output_modalities, context_length, max_output_tokens, supports_reasoning, buff_defaults } =
      (item ?? {}) as {
        id?: unknown
        name?: unknown
        input_modalities?: unknown
        output_modalities?: unknown
        context_length?: unknown
        max_output_tokens?: unknown
        supports_reasoning?: unknown
        buff_defaults?: unknown
      }
    if (typeof id !== "string" || !id) return []
    const defaults = (buff_defaults ?? {}) as { thinking?: unknown; context_tokens?: unknown }
    const context = positive(context_length)
    const output = positive(max_output_tokens)
    const contextTokens = positive(defaults.context_tokens)
    return [
      {
        id,
        name: typeof name === "string" && name ? name : id,
        input: modalities(input_modalities),
        output: modalities(output_modalities),
        limit: { ...(context ? { context } : {}), ...(output ? { output } : {}) },
        reasoning: supports_reasoning === true,
        defaults: {
          ...(typeof defaults.thinking === "string" && defaults.thinking ? { thinking: defaults.thinking } : {}),
          ...(contextTokens ? { contextTokens } : {}),
        },
      },
    ]
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
    for (const { id, name, input, output, limit, reasoning, defaults } of loaded.models) {
      providers.models.update(providerID, id, (model) => {
        model.modelID = Model.ID.make(id)
        model.name = name
        // Что модель читает и пишет — как сказал бэкенд по живому каталогу провайдера (#27).
        model.capabilities = { tools: true, input: [...input], output: [...output] }
        // Окно и потолок вывода (#838): окно организации — её дефолт, урезающий окно модели;
        // о чём склад промолчал — остаётся как было.
        model.limit = {
          ...model.limit,
          context: BuffContextWindow.effective(limit.context, defaults.contextTokens) ?? model.limit.context,
          output: limit.output ?? model.limit.output,
        }
        // Думающая модель предлагает общие уровни мышления.
        model.variants = reasoning
          ? [...Variant.resolve({ ...model, package: "@opencode/ai/providers/openai-compatible" }, [{ type: "effort", values: LEVELS }])]
          : []
        // Уровень организации (#900) — собственный уровень модели: сессия без варианта идёт на нём, выбранный вариант
        // (свой или ключ конфига thinking) ложится поверх. Запросы коннектор больше не правит.
        const preset = defaults.thinking ? Variant.closest(model.variants.map((v) => v.id), defaults.thinking) : undefined
        const own = model.variants.find((v) => v.id === preset)
        if (own) Object.assign(model, Variant.apply(model, own))
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
