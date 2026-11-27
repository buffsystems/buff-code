export * as BuffAccount from "./account.js"

import { hostname, release } from "node:os"
import { Deferred, Effect, Option, Scope, Semaphore, Stream } from "effect"
import type { Schema } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import type { StorageDomain } from "@opencode/plugin/effect/storage"
import { BuffSubscription } from "@opencode/schema/buff-subscription"
import { Credential } from "../credential.js"
import { Integration } from "../integration.js"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
import { BuffAccountCall } from "./account/call.js"
import { BuffAccountLink } from "./account/link.js"
import { BuffAccountPkce } from "./account/pkce.js"
import { BuffAccountUpload } from "./account/upload.js"
import { BuffLocale } from "./locale.js"
import { BuffLogin } from "./login.js"
import { BuffModels } from "./models.js"
import { BuffProviderFetch } from "./provider-fetch.js"

/**
 * Личный аккаунт Buff в Buff Code (#966). Человек входит своим аккаунтом buff.systems — кодом
 * авторизации с PKCE через страницу веб-клиента: пароль вводится только на сайте. Браузер на
 * этом компьютере — страница сама возвращает код на 127.0.0.1; браузера нет (SSH, WSL) —
 * человек открывает ссылку где угодно и вставляет показанный код. Подписка одна на сайт,
 * телефон и компьютер; модели — её уровни («Быстрая», «Оптимальная», …), настоящих имён нет.
 *
 * Вход компании через коннектор (`login.ts`, интеграция `buff`) и собственные ключи провайдеров
 * остаются как были: это отдельная интеграция и отдельный провайдер.
 */

export const integrationID = Integration.ID.make("buff-account")
export const providerID = Provider.ID.make("buff-account")
export const browserMethodID = Integration.MethodID.make("browser")
export const codeMethodID = Integration.MethodID.make("code")

/** Где плагин помнит уровни подписки, названные сервером в последний раз. */
const TIERS_KEY = "tiers"

/** Адрес провайдера для слоя моделей. По сети на него ничего не уходит: запрос уносит команда. */
const BASE_URL = "https://account.buff.invalid/v1"
const FIRST_LOAD = "3 seconds"

type Reply = Record<string, unknown>
const str = (value: unknown) => (typeof value === "string" && value ? value : undefined)
const said = (cause: unknown) => (cause instanceof Error && cause.message ? cause.message : String(cause))

// --- связь: одна на процесс и на сайт --------------------------------------------------------

const links = new Map<string, BuffAccountLink.Link>()

/** Настоящее соединение гостя: nats.ws грузится, только когда связь понадобилась. */
const connect =
  (host: string) =>
  async (gid: string): Promise<BuffAccountLink.Conn> => {
    const { connect: natsConnect } = await import("nats.ws")
    const conn = await natsConnect({
      servers: `wss://${host}/nats`,
      token: `guest.${gid}`,
      inboxPrefix: `_INBOX.${gid}`,
      name: "buff-code-account",
      // Короткий обрыв сети связь переживает сама; долгий — закрывается, и следующая команда поднимет новую.
      reconnect: true,
      maxReconnectAttempts: 10,
      reconnectTimeWait: 1_000,
      pingInterval: 20_000,
      maxPingOut: 3,
    })
    return {
      publish: (subject, data) => conn.publish(subject, data),
      subscribe: (subject, onMessage) => {
        const subscription = conn.subscribe(subject, {
          callback: (error, message) => void (error ?? onMessage(message.data)),
        })
        return () => subscription.unsubscribe()
      },
      maxPayload: () => conn.info?.max_payload,
      close: () => conn.close(),
      closed: conn.closed(),
    }
  }

/** Связь с сайтом аккаунта; тесты подменяют её своей. */
export function link(host: string): BuffAccountLink.Link {
  const known = links.get(host)
  if (known) return known
  const made = BuffAccountLink.make({ connect: connect(host) })
  links.set(host, made)
  return made
}

/** Подменить связь с сайтом (тесты); `undefined` — вернуть настоящую и забыть входы, известные процессу. */
export function useLink(host: string, replacement: BuffAccountLink.Link | undefined) {
  if (replacement) return void links.set(host, replacement)
  links.delete(host)
  known.clear()
  rotated.clear()
}

/** Команда с простым ответом; отказ сервера и обрыв связи — ошибкой словами для человека. */
const ask = (host: string, op: string, fields: Reply) =>
  Effect.tryPromise({
    try: () => link(host).ask(op, { ...fields, lang: BuffLocale.current() }),
    catch: () => new Error(BuffLocale.t("Buff does not answer. Check the internet connection and try again.")),
  }).pipe(
    Effect.flatMap((reply) =>
      reply.ok === false
        ? Effect.fail(new Error(str(reply.error) ?? BuffLocale.t("Buff refused the request.")))
        : Effect.succeed(reply),
    ),
  )

// --- токены ----------------------------------------------------------------------------------

/** Пара токенов из ответа сервера → учётные данные. */
function withPair(reply: Reply, methodID: Integration.MethodID, previous: Reply): Credential.OAuth {
  const access = str(reply.access)
  const refresh = str(reply.refresh)
  if (!access || !refresh) throw new Error(BuffLocale.t("The backend did not issue tokens"))
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    access,
    refresh,
    expires: Number(reply.exp ?? 0) * 1000,
    metadata: {
      ...previous,
      deviceID: str(reply.device_id) ?? previous.deviceID,
      login: str(reply.login) ?? str(BuffLogin.claims(access).sub) ?? previous.login,
    },
  })
}

// Токен обновления одноразовый: повтор старого сервер считает кражей и отзывает устройство.
// Поэтому обновления идут строго по одному на процесс, а опоздавший получает уже выданную пару.
const refreshing = Semaphore.makeUnsafe(1)
const rotated = new Map<string, Credential.OAuth>()
/** Входы, о которых знает процесс: по ним сервер узнаёт о выходе, когда учётные данные уже удалены. */
const known = new Map<string, Credential.OAuth>()

const remember = (credential: Credential.OAuth) => {
  const deviceID = str(credential.metadata?.deviceID)
  if (deviceID) known.set(deviceID, credential)
  return credential
}

/** Обновить пару: подпись ключом устройства над `developer-refresh:<устройство>:<jti>`. */
export const refresh = (storage: StorageDomain, credential: Credential.OAuth) =>
  refreshing.withPermit(
    Effect.gen(function* () {
      const spent = rotated.get(credential.refresh)
      if (spent) return spent
      const meta = (credential.metadata ?? {}) as Reply
      const deviceID = str(meta.deviceID)
      const kept = deviceID ? yield* storage.get(BuffLogin.deviceSlot(deviceID)) : undefined
      const deviceKey = str((kept as Reply | undefined)?.deviceKey)
      if (!deviceKey || !deviceID)
        return yield* Effect.fail(new Error(BuffLocale.t("The sign-in is damaged — sign in again.")))
      const reply = yield* ask(str(meta.host) ?? BuffAccountPkce.host(process.env), "developer_refresh", {
        refresh: credential.refresh,
        sig: BuffLogin.proof(deviceKey, deviceID, str(BuffLogin.claims(credential.refresh).jti) ?? ""),
      })
      const next = yield* Effect.try({
        try: () => withPair(reply, Integration.MethodID.make(credential.methodID), meta),
        catch: (cause) => new Error(said(cause)),
      })
      rotated.clear()
      rotated.set(credential.refresh, next)
      return remember(next)
    }),
  )

// --- вход ------------------------------------------------------------------------------------

/** Что готовится к входу: ключ устройства, проверочная строка, state и адрес страницы. */
function attempt(back: BuffAccountPkce.Return) {
  const host = BuffAccountPkce.host(process.env)
  const key = BuffLogin.newDeviceKey()
  const verifier = BuffAccountPkce.verifier()
  const state = BuffAccountPkce.state()
  const url = BuffAccountPkce.authorizeURL({
    origin: BuffAccountPkce.webOrigin(process.env),
    challenge: BuffAccountPkce.challenge(verifier),
    state,
    device: hostname(),
    pubkey: key.pubkey,
    return: back,
  })
  return { host, key, verifier, state, url }
}

/** Обменять код на токены. Код одноразовый: повторять обмен после потерянного ответа нельзя. */
const redeem = (
  storage: StorageDomain,
  methodID: Integration.MethodID,
  started: ReturnType<typeof attempt>,
  code: string,
) =>
  Effect.gen(function* () {
    const reply = yield* ask(started.host, "account_token", { code, verifier: started.verifier })
    const credential = yield* Effect.try({
      try: () => withPair(reply, methodID, { host: started.host }),
      catch: (cause) => new Error(said(cause)),
    })
    const deviceID = str(credential.metadata?.deviceID)
    if (!deviceID) return yield* Effect.fail(new Error(BuffLocale.t("The backend did not name the device")))
    yield* storage.set(BuffLogin.deviceSlot(deviceID), { deviceKey: started.key.deviceKey })
    // Запоминается вход позже, когда он уже сохранён: несохранённый приняли бы за удалённый.
    return credential
  })

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/** Страница, которой Buff Code отвечает браузеру после возврата. */
export function returnPage(headline: string, note: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Buff Code</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#aaa}</style></head><body><main><h1>${escape(headline)}</h1><p>${escape(note)}</p></main></body></html>`
}

/** Вход через браузер на этом компьютере: страница сама вернёт код на 127.0.0.1. */
const browser = (storage: StorageDomain) =>
  ({
    integrationID,
    method: { id: browserMethodID, type: "oauth", label: BuffLocale.t("In the browser on this computer") },
    authorize: () =>
      Effect.gen(function* () {
        const code = yield* Deferred.make<string, Error>()
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        let state = ""
        const server = createServer((request, response) => {
          const returned = BuffAccountPkce.callback(request.method, request.url, state)
          const page = (status: number, headline: string, note: string) =>
            response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(returnPage(headline, note))
          // Чужой запрос (не тот путь, не наш state): вход не принимается и не срывается.
          if (returned.type === "stranger") return void response.writeHead(404).end()
          if (returned.type === "denied") {
            Effect.runFork(Deferred.fail(code, new Error(BuffLocale.t("The sign-in was declined on the page."))))
            return void page(200, BuffLocale.t("The sign-in was declined"), BuffLocale.t("You can close this tab."))
          }
          Effect.runFork(Deferred.succeed(code, returned.code))
          page(
            200,
            BuffLocale.t("Buff Code is signed in"),
            BuffLocale.t("You can close this tab and return to Buff Code."),
          )
        })
        const port = yield* Effect.callback<number, Error>((resume) => {
          server.once("error", (error) => resume(Effect.fail(error)))
          // Только 127.0.0.1 и свободный порт: страница возвращает код именно сюда.
          server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            resume(
              address && typeof address === "object"
                ? Effect.succeed(address.port)
                : Effect.fail(new Error("no loopback port")),
            )
          })
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => void server.close()))
        const started = attempt({ type: "loopback", port })
        state = started.state
        return {
          mode: "auto" as const,
          url: started.url,
          instructions: BuffLocale.t(
            "Allow the sign-in on the page that opens in the browser — Buff Code will continue by itself. No browser on this computer? Choose the sign-in with a link and a code.",
          ),
          callback: Deferred.await(code).pipe(
            Effect.flatMap((value) => redeem(storage, browserMethodID, started, value)),
          ),
        }
      }),
    refresh: (credential) => refresh(storage, credential),
    label,
  }) satisfies IntegrationOAuthMethodRegistration

/** Вход без браузера на этом компьютере: ссылка открывается где угодно, код вставляется сюда. */
const paste = (storage: StorageDomain) =>
  ({
    integrationID,
    method: {
      id: codeMethodID,
      type: "oauth",
      label: BuffLocale.t("With a link and a code — over SSH or without a browser"),
    },
    authorize: () =>
      Effect.sync(() => {
        const started = attempt({ type: "paste" })
        return {
          mode: "code" as const,
          url: started.url,
          instructions: BuffLocale.t(
            "Open the link on any device, allow the sign-in and paste the code shown on the page here.",
          ),
          callback: (text: string) => {
            const returned = BuffAccountPkce.pasted(text, started.state)
            if (returned.type === "code") return redeem(storage, codeMethodID, started, returned.code)
            return Effect.fail(
              new Error(
                returned.type === "stranger" && returned.reason === "state"
                  ? BuffLocale.t(
                      "This code is from another sign-in attempt. Start the sign-in again and paste the new code.",
                    )
                  : BuffLocale.t(
                      "This is not the code from the sign-in page. Start the sign-in again and paste the whole line the page shows.",
                    ),
              ),
            )
          },
        }
      }),
    refresh: (credential) => refresh(storage, credential),
    label,
  }) satisfies IntegrationOAuthMethodRegistration

function label(credential: Credential.OAuth) {
  return str(credential.metadata?.login)
}

// --- слова -----------------------------------------------------------------------------------

/** Размер словами: «16 МБ», «1,5 МБ». */
export function megabytes(bytes: number): string {
  const value = String(Math.round((bytes / 1_048_576) * 10) / 10)
  return BuffLocale.t("{n} MB", { n: BuffLocale.current() === "ru" ? value.replace(".", ",") : value })
}

const tooLarge = (limit: number) =>
  BuffLocale.t("The model request is too large (maximum {limit}). Shorten the context or remove some attachments.", {
    limit: megabytes(limit),
  })

/** Так сервер говорит, что устройство отозвано: на сайте, выходом или повторным использованием кода. */
const REVOKED = new Set(["Устройство отозвано — войдите заново.", "The device was revoked — sign in again."])
export const revoked = (cause: unknown): boolean => REVOKED.has(said(cause))

// --- плагин ----------------------------------------------------------------------------------

/** Вход на этом компьютере завершён сервером — словами для человека. */
class Gone extends Error {
  constructor() {
    super(
      BuffLocale.t(
        "The Buff account sign-in on this computer has ended: the device was revoked on the site or the sign-in was made anew. Sign in again.",
      ),
    )
  }
}

type SignedIn = {
  readonly id: string
  readonly deviceID: string | undefined
  readonly credential: Credential.OAuth
  readonly host: string
}
type Failure = { readonly kind: "signed_out" | "unreachable"; readonly message: string }

export const Plugin = define<Credential.Service | Scope.Scope>({
  id: "buff.account",
  effect: Effect.fn(function* (ctx) {
    const credentials = yield* Credential.Service
    const storage = ctx.storage
    // Журнал и токен нужны из обещаний (ответчик провайдера) — они исполняются в окружении плагина.
    const context = yield* Effect.context<never>()
    const runFork = Effect.runForkWith(context)
    const runPromise = Effect.runPromiseWith(context)

    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = BuffLocale.t("Buff account")
      })
      // Сначала тот способ, который здесь сработает: без браузера — ссылка и код.
      const methods = [browser(storage), paste(storage)]
      for (const method of BuffAccountPkce.headless(process.env, process.platform, release())
        ? methods.toReversed()
        : methods)
        editor.method.update(method)
    })

    /** Сайт аккаунта того, кто вошёл: вход помнит свой — стенд это или buff.systems. */
    let host = BuffAccountPkce.host(process.env)

    /**
     * Сервер отозвал устройство (на сайте, выходом в другом месте, повторным кодом): сохранённый
     * вход бесполезен — он удаляется вместе с ключом, а человеку говорится, что случилось.
     */
    const dropRevoked = <A, E>(
      me: { readonly id: string; readonly deviceID: string | undefined },
      effect: Effect.Effect<A, E>,
    ): Effect.Effect<A, E | Error> =>
      effect.pipe(
        Effect.catch((cause): Effect.Effect<never, E | Error> => {
          if (!revoked(cause)) return Effect.fail(cause)
          return Effect.gen(function* () {
            // Сообщать серверу о выходе незачем: он сам отозвал устройство.
            if (me.deviceID) known.delete(me.deviceID)
            yield* credentials.remove(Credential.ID.make(me.id))
            if (me.deviceID) yield* storage.remove(BuffLogin.deviceSlot(me.deviceID))
            return yield* Effect.fail(new Gone())
          })
        }),
      )

    /** Кто вошёл: свежие учётные данные (обновляются перед сроком) и сайт аккаунта. */
    const signedIn: Effect.Effect<SignedIn | undefined, Error> = Effect.gen(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      if (!connection || connection.type === "env") return undefined
      const stored = yield* credentials.get(Credential.ID.make(connection.id))
      const deviceID = stored?.value.type === "oauth" ? str(stored.value.metadata?.deviceID) : undefined
      const credential = yield* dropRevoked(
        { id: connection.id, deviceID },
        ctx.integration.connection.resolve(connection).pipe(Effect.mapError((cause) => new Error(said(cause)))),
      )
      if (credential?.type !== "oauth") return undefined
      remember(credential)
      host = str(credential.metadata?.host) ?? BuffAccountPkce.host(process.env)
      return { id: connection.id, deviceID, credential, host }
    })

    /** Токен для вызова; `renew` — сервер не принял прежний: обновить пару и сохранить её до использования. */
    const token = (renew: boolean) =>
      Effect.gen(function* () {
        const me = yield* signedIn
        if (!me) return yield* Effect.fail(new Error(BuffLocale.t("Not signed in to the Buff account.")))
        if (!renew) return me
        const value = yield* dropRevoked(me, refresh(storage, me.credential))
        yield* credentials.update(Credential.ID.make(me.id), { value })
        return { ...me, credential: value }
      })

    // --- модели: уровни подписки ---
    const loaded: { models?: BuffSubscription.Models; at: number; limits?: BuffAccountUpload.Limits } = { at: 0 }
    const load = Effect.gen(function* () {
      const me = yield* signedIn
      if (!me) {
        loaded.models = undefined
        yield* storage.remove(TIERS_KEY)
        return
      }
      const reply = yield* dropRevoked(me, ask(me.host, "chat_models", { token: me.credential.access }))
      const fresh = BuffSubscription.models(reply)
      // Подписка закончилась или заблокирована — сервер уровней не называет. Прежние уровни остаются:
      // запрос дойдёт до сервера, и человек прочтёт его отказ («Доступ к чату остановлен…»), а не
      // «модель недоступна, подключите провайдера».
      if (fresh.tiers.length > 0)
        yield* storage.set(TIERS_KEY, { tiers: reply.tiers, default: reply.default, small: reply.small } as Schema.Json)
      const kept = fresh.tiers.length === 0 ? BuffSubscription.models(yield* storage.get(TIERS_KEY)) : undefined
      loaded.models = kept && kept.tiers.length > 0 ? { ...kept, plan: fresh.plan, request: fresh.request } : fresh
      loaded.at = Date.now()
      // Пределы большого запроса — настройка установки: берутся отсюда, а не из кода.
      loaded.limits = BuffAccountUpload.limits(loaded.models.request)
    }).pipe(
      // Сбой сети не гасит уже известные уровни: список обновится при следующем входе или запуске.
      Effect.catch((cause) =>
        Effect.logWarning("Buff account: the model tiers are unavailable", { cause: said(cause) }),
      ),
    )

    yield* ctx.provider.transform((providers) => {
      const models = loaded.models
      if (!models || models.tiers.length === 0) return
      const locale = BuffLocale.current()
      providers.update(providerID, (provider) => {
        provider.name = BuffLocale.t("Buff subscription")
        provider.activation = "auto"
        provider.integrationID = integrationID
        provider.package = "@opencode/ai/providers/openai-compatible"
        provider.settings = { baseURL: BASE_URL, provider: providerID }
      })
      // Уровень по умолчанию — первым: с него начинает тот, кто ещё ничего не выбирал.
      const ordered = models.tiers.toSorted((a, b) => Number(b.id === models.default) - Number(a.id === models.default))
      for (const tier of ordered) {
        providers.models.update(providerID, tier.id, (model) => {
          model.modelID = Model.ID.make(tier.id)
          model.name = BuffSubscription.tierName(tier, locale)
          model.capabilities = { tools: tier.tools, input: [...tier.input], output: [...tier.outputs] }
          model.limit = {
            ...model.limit,
            context: tier.context ?? model.limit.context,
            output: tier.output ?? model.limit.output,
          }
          // Умеет ли уровень думать, сервер не говорит: уровней мышления не предлагаем.
          model.variants = []
          // Расход покрывает подписка: цен за токены у уровня нет.
          model.cost = []
          model.time = { released: loaded.at }
          model.family = Model.Family.make(tier.id)
        })
      }
    })

    const fetch = BuffAccountCall.fetcher({
      token: (renew) => runPromise(token(renew).pipe(Effect.map((me) => me.credential.access))),
      stream: (fields, signal) => link(host).stream("chat_model_call", fields, signal),
      part: (fields) => {
        const chunk = fields.chunk as { seq?: number; of?: number } | undefined
        const bytes = Math.floor((String(fields.data ?? "").length * 3) / 4)
        runFork(Effect.logInfo("Buff account: request piece", { seq: chunk?.seq, of: chunk?.of, bytes }))
        return link(host).ask("chat_model_part", fields)
      },
      limit: () => link(host).limit(),
      limits: () => loaded.limits ?? BuffAccountUpload.DEFAULTS,
      lang: () => BuffLocale.current(),
      tooLarge,
      lost: () => BuffLocale.t("The connection to Buff was lost. Check the internet connection."),
      failed: () => BuffLocale.t("The model could not answer this time. Repeat the request."),
    })

    // Метки расхода: сессия, сообщение-ответ и вид вызова — как у моделей организации.
    yield* ctx.session.hook(
      "model.request",
      (evt) =>
        Effect.sync(() => {
          if (evt.model.providerID !== providerID) return
          Object.assign(evt.headers, BuffModels.requestHeaders(null, evt.sessionID, evt.kind, evt.messageID))
        }),
      { providerID },
    )
    // Запрос к модели уходит не по HTTP, а командой через связь с сайтом аккаунта — и из сессии,
    // и разовый (текст коммита): слой моделей отдаёт его сюда вместо сети.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        BuffProviderFetch.register(providerID, (request, signal) => {
          let bytes = 0
          return fetch(request, signal, (size) => (bytes = size)).then(async (response) => {
            // По размеру видно, как близко сессия к потолку одной команды; у отказа — его вид.
            const refusal =
              response.status >= 400
                ? await response
                    .clone()
                    .json()
                    .then((body) => String((body as { error?: { type?: unknown } } | null)?.error?.type ?? ""))
                    .catch(() => "")
                : undefined
            runFork(Effect.logInfo("Buff account: model request", { bytes, status: response.status, refusal }))
            // Отказ по размеру или сроку — повод перечитать пределы: оператор мог их сменить.
            if (response.status === 400 || response.status === 413) runFork(load)
            return response
          })
        }),
      ),
      (remove) => Effect.sync(remove),
    )

    // --- расход подписки ---
    const usage: Effect.Effect<BuffSubscription.Usage, Failure> = Effect.gen(function* () {
      const unreachable = (cause: unknown): Failure => ({
        kind: "unreachable",
        message: BuffLocale.t("Could not get the subscription usage: {detail}", { detail: said(cause) }),
      })
      // Вход завершён сервером — это «входа нет» его словами, а не сбой связи.
      const failure = (cause: unknown): Failure =>
        cause instanceof Gone ? { kind: "signed_out", message: cause.message } : unreachable(cause)
      const me = yield* signedIn.pipe(Effect.mapError(failure))
      if (!me)
        return yield* Effect.fail<Failure>({
          kind: "signed_out",
          message: BuffLocale.t("Not signed in to the Buff account."),
        })
      const reply = yield* dropRevoked(me, ask(me.host, "chat_usage", { token: me.credential.access })).pipe(
        Effect.mapError(failure),
      )
      return BuffSubscription.usage(reply, str(me.credential.metadata?.login) ?? null)
    })
    yield* ctx.rpc
      .register(BuffSubscription.Rpc, {
        get: (_input, call) => usage.pipe(Effect.mapError((f) => call.error(f.kind, f.message, {}))),
      })
      .pipe(Effect.orDie)

    // --- выход: сервер узнаёт о нём, ключ устройства удаляется ---
    const signOutGone = Effect.gen(function* () {
      const kept = new Set(
        (yield* credentials.list(integrationID)).flatMap((item) =>
          item.value.type === "oauth" ? [str(item.value.metadata?.deviceID)] : [],
        ),
      )
      for (const [deviceID, gone] of [...known]) {
        if (kept.has(deviceID)) continue
        // Другой каталог того же процесса мог уже сообщить о выходе.
        if (!known.delete(deviceID)) continue
        // Токен истёк — обновляем, пока ключ устройства ещё здесь; дальше ключ не нужен и удаляется
        // сразу: разовая команда может завершиться раньше, чем сервер ответит.
        const fresh =
          gone.expires > Date.now() + 30_000
            ? gone
            : yield* refresh(storage, gone).pipe(Effect.orElseSucceed(() => gone))
        yield* storage.remove(BuffLogin.deviceSlot(deviceID))
        yield* ask(str(gone.metadata?.host) ?? BuffAccountPkce.host(process.env), "developer_signout", {
          token: fresh.access,
        }).pipe(
          // Сервер недоступен или токен истёк: устройство можно отозвать на сайте, а здесь вход всё равно удалён.
          Effect.catch((cause) =>
            Effect.logWarning("Buff account: sign-out did not reach the server", { cause: said(cause) }),
          ),
        )
      }
    })

    const reload = load.pipe(Effect.andThen(ctx.provider.reload()))
    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event) =>
          event.type === "credential.switched" &&
          (event.data as { integrationID?: string } | undefined)?.integrationID === integrationID,
      ),
      Stream.runForEach(() => signOutGone.pipe(Effect.andThen(reload))),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Язык сменили — имена уровней, провайдера и способов входа говорятся заново, на нём.
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "rpc.buff.locale.changed"),
      Stream.runForEach(() => ctx.integration.reload().pipe(Effect.andThen(ctx.provider.reload()))),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Первый список — до готовности, но молчащая сеть не держит запуск: дальше список догоняет фоном.
    const first = yield* reload.pipe(Effect.timeoutOption(FIRST_LOAD))
    if (Option.isNone(first)) yield* reload.pipe(Effect.forkScoped)
  }),
})
