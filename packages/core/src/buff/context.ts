export * as BuffWorkContext from "./context.js"

import { Effect, Schema } from "effect"
import type { Scope } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffContext } from "@opencode/schema/buff-context"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { BuffBillingReader } from "./billing.js"
import { BuffDraw } from "./draw.js"
import { BuffModels } from "./models.js"
import { BuffOutboxSender } from "./outbox-sender.js"
import { BuffTools } from "./tools.js"
import { BuffLocale } from "./locale.js"

/**
 * Рабочий контекст Buff Code (#391): организация → проект или «без проекта» →
 * пространства знаний, выбранные за этим каталогом. Хранится здесь, в ядре; консоль,
 * терминальный интерфейс и десктоп читают и меняют его через rpc `buff.context`.
 *
 * Выбирать можно только из того, что разрешено: списки берутся у бэкенда через шлюз
 * коннектора компании токеном разработчика (#366), а бэкенд сужает их до организаций
 * токена и грантов участника (#298). Выбор проверяется по свежему списку при каждой смене.
 */

type Reply = Record<string, unknown>
type Failure = { readonly kind: "signed_out" | "unreachable"; readonly message: string }

const SIGNED_OUT = "Not signed in to Buff."
const decodeChoice = Schema.decodeUnknownOption(BuffContext.Choice)

const items = (list: unknown): BuffContext.Options["projects"] =>
  (Array.isArray(list) ? list : []).flatMap((entry) => {
    const e = (entry ?? {}) as Reply
    return typeof e.org === "string" && typeof e.name === "string" ? [{ org: e.org, name: e.name }] : []
  })

/** Ключ выбора в хранилище плагина: у каждого каталога — свой (второй каталог спросит заново). */
export const contextKey = (directory: string): string => `context:${directory}`

/**
 * Где искать выбор для каталога: сам каталог, затем основной каталог его проекта. Рабочее
 * дерево — новый каталог того же проекта, и спрашивать контекст заново в каждом дереве незачем;
 * выбор, сделанный в самом дереве, сильнее.
 */
export function contextKeys(location: {
  readonly directory: string
  readonly project: { readonly canonical: string }
}): string[] {
  const own = contextKey(location.directory)
  const project = contextKey(location.project.canonical)
  return own === project ? [own] : [own, project]
}

/** Каталог, где контекст выбирали последним (#466). */
const LAST_DIRECTORY_KEY = "last-context-directory"

/** Разрешён ли выбор: организация из списка, проект и пространства — её собственные. */
export function allowed(choice: BuffContext.Choice, options: BuffContext.Options): boolean {
  if (!options.orgs.includes(choice.org)) return false
  const own = (list: BuffContext.Options["projects"], name: string) =>
    list.some((item) => item.org === choice.org && item.name === name)
  if (choice.project !== null && !own(options.projects, choice.project)) return false
  return choice.spaces.every((space) => own(options.spaces, space))
}

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "buff.context",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    const key = contextKey(ctx.location.directory)

    /** Вход в Buff: свежий токен разработчика и адрес коннектора компании. */
    const signedIn: Effect.Effect<BuffModels.SignedIn | undefined> = Effect.gen(function* () {
      const connection = yield* ctx.integration.connection.active("buff")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const meta = (credential?.metadata ?? {}) as Reply
      const token = credential?.type === "oauth" ? credential.access : undefined
      return token && typeof meta.connector === "string" ? { token, connector: meta.connector } : undefined
    })

    const savedAt = (storageKey: string): Effect.Effect<BuffContext.Choice | null> =>
      ctx.storage
        .get(storageKey)
        .pipe(Effect.map((value) => decodeChoice(value).pipe((o) => (o._tag === "Some" ? o.value : null))))
    const saved: Effect.Effect<BuffContext.Choice | null> = Effect.gen(function* () {
      for (const storageKey of contextKeys(ctx.location)) {
        const choice = yield* savedAt(storageKey)
        if (choice) return choice
      }
      return null
    })

    /**
     * Каталог, где контекст выбирали последним (#466). Настройки десктопа открыты не в каталоге
     * проекта: чтобы показать подключение и модели, они смотрят сюда. В профилях, где последний
     * выбор ещё не записан, годится любой каталог с выбором.
     */
    const lastDirectory: Effect.Effect<string | null> = Effect.gen(function* () {
      const last = yield* ctx.storage.get(LAST_DIRECTORY_KEY)
      if (typeof last === "string") return last
      const prefix = contextKey("")
      const found = yield* ctx.storage.scan({ prefix, limit: 1 })
      return found.entries[0]?.key.slice(prefix.length) ?? null
    })

    /** Списки — через шлюз коннектора, свежим токеном разработчика. */
    const fetchOptions: Effect.Effect<BuffContext.Options, Failure> = Effect.gen(function* () {
      const me = yield* signedIn
      if (!me) return yield* Effect.fail<Failure>({ kind: "signed_out", message: BuffLocale.t(SIGNED_OUT) })
      const { token, connector } = me
      const unreachable = (detail: string): Failure => ({
        kind: "unreachable",
        message: BuffLocale.t("The company connector did not answer: {detail}", { detail }),
      })
      const response = yield* HttpClientRequest.post(`${connector}/v1/developer/workspace`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyJsonUnsafe({ token }),
        (request) => http.execute(request),
        Effect.mapError((cause) => unreachable(String(cause))),
      )
      const parsed = yield* response.json.pipe(Effect.orElseSucceed(() => ({})))
      const reply = (parsed ?? {}) as Reply
      if (response.status >= 400 || reply.ok === false)
        return yield* Effect.fail(unreachable(typeof reply.error === "string" ? reply.error : BuffLocale.t("code {status}", { status: response.status })))
      return {
        orgs: Array.isArray(reply.orgs) ? reply.orgs.filter((o): o is string => typeof o === "string") : [],
        projects: items(reply.projects),
        spaces: items(reply.spaces),
      }
    })

    // Сквозная запись (#439): строки базы движка разработчика уходят в склад через шлюз
    // коннектора — свежим токеном разработчика, в выбранные организацию и проект.
    const unregister = BuffOutboxSender.register(
      Effect.gen(function* () {
        const me = yield* signedIn
        const choice = yield* saved
        if (!me || !choice) return null
        return {
          url: `${me.connector}/v1/engine/rows`,
          headers: {
            Authorization: `Bearer ${me.token}`,
            "X-Buff-Org": choice.org,
            ...(choice.project ? { "X-Buff-Project": choice.project } : {}),
          },
        }
      }),
    )
    yield* Effect.addFinalizer(() => Effect.sync(unregister))

    const reloadModels = yield* BuffModels.register(ctx, http, { signedIn, choice: saved })
    const recheckTools = yield* BuffTools.register(ctx, signedIn, saved)
    // Картинки по просьбе (#27): художник организации, файл — в папку сессии.
    yield* BuffDraw.register(ctx, { signedIn, choice: saved })
    yield* BuffBillingReader.register(ctx, http, { signedIn, choice: saved })

    // The event is sent through the registration the handlers belong to, which exists only
    // after they are registered — hence the late binding.
    let changed: (choice: BuffContext.Choice) => Effect.Effect<void> = () => Effect.void
    const registration = yield* ctx.rpc
      .register(BuffContext.Rpc, {
        get: () => saved,
        lastDirectory: () => lastDirectory,
        options: (_input, call) => fetchOptions.pipe(Effect.mapError((f) => call.error(f.kind, f.message, {}))),
        set: (choice, call) =>
          Effect.gen(function* () {
            const options = yield* fetchOptions.pipe(Effect.mapError((f) => call.error(f.kind, f.message, {})))
            if (!allowed(choice, options))
              return yield* Effect.fail(
                call.error(
                  "not_allowed",
                  BuffLocale.t("This is not among what is available to you: an organization, project or space without access."),
                  {},
                ),
              )
            const kept = { org: choice.org, project: choice.project, spaces: [...choice.spaces] }
            yield* ctx.storage.set(key, kept)
            yield* ctx.storage.set(LAST_DIRECTORY_KEY, ctx.location.directory)
            yield* changed(kept)
            // Модели — маршрут организации (#370): другая организация — другой список.
            yield* reloadModels
            // Знания — рабочего контекста (#371): другой контекст — другие записи.
            yield* recheckTools
            return kept
          }),
      })
      .pipe(Effect.orDie)
    changed = (choice) => registration.events.emit("changed", choice).pipe(Effect.ignore)
  }),
})
