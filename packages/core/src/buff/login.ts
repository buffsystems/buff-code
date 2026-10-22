export * as BuffLogin from "./login.js"

import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto"
import { hostname } from "node:os"
import { Duration, Effect, Scope } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import type { Registration } from "@opencode/plugin/effect/registration"
import type { StorageDomain } from "@opencode/plugin/effect/storage"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Credential } from "../credential.js"
import { Integration } from "../integration.js"
import { BuffLocale } from "./locale.js"

/**
 * Вход разработчика (#366). Коннектор стоит в сети компании, а не на машине разработчика:
 * Buff Code входит через него. Коннектор пересылает на бэкенд начало входа, ожидание
 * ответа кабинета и обновление. Токены остаются здесь, в хранилище учётных данных, а ключ
 * устройства — в хранилище плагина: сведения учётных данных уходят в настройки провайдера,
 * и закрытому ключу там не место (#370). Обновление подписывается этим ключом, так что
 * токен обновления без ключа бесполезен.
 */

const integrationID = Integration.ID.make("buff")
const methodID = Integration.MethodID.make("device")
/** Раскатка на много машин: адрес задаётся заранее, и форма его не спрашивает. */
const CONNECTOR_ENV = "BUFF_CONNECTOR_URL"
/** Шаг опроса по RFC 8628, если бэкенд его не назвал. */
const DEFAULT_INTERVAL_S = 5

type Reply = Record<string, unknown>

/** Где лежит ключ устройства: у каждого входа — свой. */
export const deviceSlot = (deviceID: string): string => `device:${deviceID}`

/** Новый ключ устройства: закрытый ключ PKCS#8 (хранится) и открытый ключ SPKI (уходит бэкенду). */
export function newDeviceKey(): { deviceKey: string; pubkey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" })
  return {
    deviceKey: pkcs8.toString("base64url"),
    pubkey: publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
  }
}

/** Подпись обновления — байт в байт как developerPopMessage(deviceId, jti) на бэкенде. */
function proof(deviceKey: string, deviceID: string, jti: string): string {
  const key = createPrivateKey({ key: Buffer.from(deviceKey, "base64url"), format: "der", type: "pkcs8" })
  return sign(null, Buffer.from(`developer-refresh:${deviceID}:${jti}`), key).toString("base64url")
}

/** Полезная нагрузка токена без проверки подписи: проверяет бэкенд. */
function claims(token: string): Reply {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Reply
  } catch {
    return {}
  }
}

const str = (value: unknown) => (typeof value === "string" ? value : undefined)

const ADDRESS_SHAPE = "The connector address must start with https:// — for example, https://connector.company.local:8767"

function normalizeConnector(input: unknown) {
  return Effect.try({
    try: () => {
      if (typeof input !== "string") throw new Error(BuffLocale.t(ADDRESS_SHAPE))
      const url = new URL(input)
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(BuffLocale.t(ADDRESS_SHAPE))
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
    },
    catch: () => new Error(BuffLocale.t(ADDRESS_SHAPE)),
  })
}

/** Чем кончилось обращение к коннектору, если не успехом. */
export type ConnectorFailure =
  | { readonly kind: "transport" }
  | { readonly kind: "reply"; readonly status: number; readonly error?: string; readonly html?: boolean }

/** Так шлюз разработчика отвечает на путь, которого у него нет. */
const UNKNOWN_PATH = "нет такого адреса"

/**
 * Причина отказа словами, по которым понятно, что исправить (#458). Человек вводит адрес
 * руками и ошибается в нём чаще всего — «Transport error» и «ответил 405» этого не говорят.
 * Отказ самого бэкенда (устройство отозвано, код истёк) приходит его словами.
 */
export function connectorFailure(connector: string, failure: ConnectorFailure): string {
  if (failure.kind === "transport")
    return BuffLocale.t(
      "The connector at {connector} does not answer. Check the address and the connection to the company network.",
      { connector },
    )
  const stranger = BuffLocale.t(
    "What answers at {connector} is not a Buff connector. The connector address is shown in the cabinet, under “Connectors”.",
    { connector },
  )
  if (failure.html || failure.error === UNKNOWN_PATH) return stranger
  if (failure.error) return failure.error
  if (failure.status === 404 || failure.status === 405) return stranger
  return BuffLocale.t(
    "The connector at {connector} answered with error {status}. Try again later or contact your administrator.",
    { connector, status: failure.status },
  )
}

/** Одна команда через коннектор. Отказ бэкенда приходит его словами. */
const post = Effect.fnUntraced(function* (connector: string, path: string, body: Reply) {
  const http = yield* HttpClient.HttpClient
  const fail = (failure: ConnectorFailure) => Effect.fail(new Error(connectorFailure(connector, failure)))
  const response = yield* HttpClientRequest.post(`${connector}${path}`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bodyJsonUnsafe(body),
    (request) => http.execute(request),
    Effect.catch(() => fail({ kind: "transport" })),
  )
  const parsed = yield* response.json.pipe(Effect.orElseSucceed(() => undefined))
  const json = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
  const reply: Reply = json ? (parsed as Reply) : {}
  if (response.status >= 400 || reply.ok === false || !json)
    return yield* fail({
      kind: "reply",
      status: response.status,
      error: str(reply.error),
      html: !json && response.status < 400,
    })
  return reply
})

/** Пара токенов → учётные данные; прочие сведения берутся из прежних. */
function withPair(reply: Reply, previous: Reply): Credential.OAuth {
  const access = str(reply.access)
  const refresh = str(reply.refresh)
  if (!access || !refresh) throw new Error(BuffLocale.t("The backend did not issue tokens"))
  const c = claims(access)
  const orgs = Array.isArray(c.orgs) ? c.orgs.filter((o): o is string => typeof o === "string") : previous.orgs
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    access,
    refresh,
    expires: Number(reply.exp ?? 0) * 1000,
    metadata: {
      ...previous,
      deviceID: str(reply.device_id) ?? previous.deviceID,
      login: str(c.sub) ?? previous.login,
      org: str(reply.org) ?? previous.org,
      orgs,
    },
  })
}

function wait(
  storage: StorageDomain,
  connector: string,
  deviceCode: string,
  every: Duration.Duration,
  deviceKey: string,
) {
  const loop: Effect.Effect<Credential.OAuth, unknown, HttpClient.HttpClient> = Effect.gen(function* () {
    yield* Effect.sleep(every)
    const reply = yield* post(connector, "/v1/developer/device/poll", { device_code: deviceCode })
    switch (reply.status) {
      case "pending":
        return yield* loop
      case "approved": {
        const credential = withPair(reply, { connector })
        const deviceID = str((credential.metadata ?? {}).deviceID)
        if (!deviceID) return yield* Effect.fail(new Error(BuffLocale.t("The backend did not name the device")))
        yield* storage.set(deviceSlot(deviceID), { deviceKey })
        return credential
      }
      case "denied":
        return yield* Effect.fail(new Error(BuffLocale.t("Sign-in was declined in the cabinet.")))
      default:
        return yield* Effect.fail(new Error(BuffLocale.t("The sign-in code has expired — start signing in again.")))
    }
  })
  return loop
}

/** Обновить пару: коннектор пересылает, бэкенд проверяет подпись ключом устройства. */
export const refresh = Effect.fnUntraced(function* (storage: StorageDomain, credential: Credential.OAuth) {
  const meta = (credential.metadata ?? {}) as Reply
  const connector = str(meta.connector)
  const deviceID = str(meta.deviceID)
  const kept = deviceID ? yield* storage.get(deviceSlot(deviceID)) : undefined
  const deviceKey = str((kept as Reply | undefined)?.deviceKey)
  if (!connector || !deviceKey || !deviceID) return yield* Effect.fail(new Error(BuffLocale.t("The sign-in is damaged — sign in again.")))
  const jti = str(claims(credential.refresh).jti) ?? ""
  const reply = yield* post(connector, "/v1/developer/refresh", {
    refresh: credential.refresh,
    sig: proof(deviceKey, deviceID, jti),
  })
  return withPair(reply, meta)
})

/** Последний адрес коннектора, с которым вход удался (#470): после выхода его не вводят заново. */
const LAST_CONNECTOR = "last-connector"

function registration(
  http: HttpClient.HttpClient,
  storage: StorageDomain,
  remembered: string | undefined,
  signedIn: (connector: string) => Effect.Effect<void>,
) {
  const preset = process.env[CONNECTOR_ENV]
  return {
    integrationID,
    method: {
      id: methodID,
      type: "oauth",
      label: BuffLocale.t("Sign in through the company connector"),
      form: [
        {
          key: "connector",
          type: "string",
          required: true,
          title: BuffLocale.t("Your company's connector address"),
          description: BuffLocale.t("Your administrator shows it in the Buff cabinet, under “Connectors”."),
          placeholder: "https://connector.company.local:8767",
          ...(preset ? { default: preset, hidden: true } : remembered ? { default: remembered } : {}),
        },
      ],
    },
    authorize: (answer) =>
      Effect.gen(function* () {
        const connector = yield* normalizeConnector(answer.connector ?? preset)
        const key = newDeviceKey()
        const started = yield* post(connector, "/v1/developer/device/start", {
          device_name: hostname(),
          pubkey: key.pubkey,
        })
        const code = str(started.user_code)
        const deviceCode = str(started.device_code)
        const uri = str(started.verification_uri)
        if (!code || !deviceCode || !uri) return yield* Effect.fail(new Error(BuffLocale.t("The backend did not issue a sign-in code")))
        const url = new URL(uri)
        url.searchParams.set("code", code)
        const every = Duration.seconds(Number(started.interval ?? DEFAULT_INTERVAL_S))
        // Срок кода — бэкенда (#457): окно входа показывает, сколько он ещё действует.
        const lifetime = Number(started.expires_in)
        return {
          mode: "auto" as const,
          ...(Number.isFinite(lifetime) && lifetime > 0 ? { expiresAt: Date.now() + lifetime * 1000 } : {}),
          url: url.href,
          instructions: BuffLocale.t("Confirm the sign-in in the cabinet. Code: {code}", { code }),
          callback: wait(storage, connector, deviceCode, every, key.deviceKey).pipe(
            Effect.tap(() => signedIn(connector)),
            Effect.provideService(HttpClient.HttpClient, http),
          ),
        }
      }).pipe(Effect.provideService(HttpClient.HttpClient, http)),
    refresh: (credential) => refresh(storage, credential).pipe(Effect.provideService(HttpClient.HttpClient, http)),
    label: (credential) => {
      const meta = (credential.metadata ?? {}) as Reply
      return [str(meta.login), str(meta.org)].filter(Boolean).join(" · ") || undefined
    },
  } satisfies IntegrationOAuthMethodRegistration
}

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "buff.login",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    // Форма входа помнит последний коннектор (#470): после удачного входа регистрация
    // пересобирается с ним, прежняя снимается — в области плагина.
    const scope = yield* Effect.scope
    let current: Registration | undefined
    const register = (remembered: string | undefined): Effect.Effect<void> =>
      Effect.gen(function* () {
        const next = yield* ctx.integration
          .transform((editor) => {
            editor.update("buff", (integration) => {
              integration.name = "Buff"
            })
            editor.method.update(registration(http, ctx.storage, remembered, remember))
          })
          .pipe(Effect.provideService(Scope.Scope, scope))
        if (current) yield* current.dispose
        current = next
      })
    const remember = (connector: string) =>
      ctx.storage.set(LAST_CONNECTOR, connector).pipe(Effect.andThen(register(connector)), Effect.ignore)
    yield* register(str(yield* ctx.storage.get(LAST_CONNECTOR)))
  }),
})
