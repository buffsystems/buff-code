// Личный аккаунт Buff в Buff Code (#966): вход кодом авторизации с PKCE, уровни моделей, расход, выход.
import { describe, expect } from "bun:test"
import { createHash, createPrivateKey, createPublicKey, verify } from "node:crypto"
import { Effect } from "effect"
import { BuffLocale as BuffLocaleSchema } from "@opencode/schema/buff-locale"
import { BuffSubscription } from "@opencode/schema/buff-subscription"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { BuffAccount } from "@opencode/core/buff/account"
import type { BuffAccountLink } from "@opencode/core/buff/account/link"
import { BuffLocale } from "@opencode/core/buff/locale"
import { BuffLogin } from "@opencode/core/buff/login"
import { BuffProviderFetch } from "@opencode/core/buff/provider-fetch"
import { testEffect } from "../lib/effect"
import { PluginTestLayerWithMcp as PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const HOST = "buff.systems"

type Raw = Record<string, unknown>
const jwt = (payload: Raw) => `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`

const TIERS = {
  ok: true,
  tiers: [
    {
      id: "fast",
      name: "Быстрая",
      name_en: "Fast",
      context: 200000,
      max_output: 16384,
      input: ["text"],
      output: ["text"],
      tools: true,
    },
    {
      id: "optimal",
      name: "Оптимальная",
      name_en: "Optimal",
      context: 400000,
      max_output: null,
      input: ["text", "image"],
      output: ["text"],
      tools: true,
    },
  ],
  default: "optimal",
  small: "fast",
  subscription: { status: "active", plan: "plus", plan_name: "Средний", plan_name_en: "Plus", active_until: null },
}

/** Сайт аккаунта: помнит команды и отвечает как сервер по контракту. */
function site(answers: Partial<Record<string, (fields: Raw) => Raw>> = {}) {
  const seen: Array<{ op: string; fields: Raw }> = []
  const link: BuffAccountLink.Link = {
    ask: async (op, fields) => {
      seen.push({ op, fields })
      const answer = answers[op]
      if (answer) return answer(fields)
      if (op === "account_token")
        return {
          ok: true,
          login: "ivan",
          access: jwt({ sub: "ivan" }),
          refresh: jwt({ jti: "r1" }),
          exp: 2_000_000_000,
          device_id: "dev_1",
        }
      if (op === "chat_models") return TIERS
      if (op === "chat_model_part") {
        const chunk = fields.chunk as { seq: number; of: number }
        return { ok: true, received: chunk.seq + 1, of: chunk.of }
      }
      return { ok: true }
    },
    stream: async function* (op, fields) {
      seen.push({ op, fields })
      yield new Uint8Array(Buffer.from('{"status":200,"content_type":"text/event-stream"}\ndata: {"model":"fast"}\n\n'))
      yield new Uint8Array(Buffer.from("data: [DONE]\n\n"))
    },
    limit: async () => 1_048_576,
    close: async () => undefined,
  }
  return { seen, link, of: (op: string) => seen.filter((item) => item.op === op).map((item) => item.fields) }
}

const withSite = <A, E, R>(made: ReturnType<typeof site>, use: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => BuffAccount.useLink(HOST, made.link)),
    () => use,
    () => Effect.sync(() => BuffAccount.useLink(HOST, undefined)),
  )

const addPlugin = Effect.fn(function* () {
  const host = yield* PluginHost.make(yield* Plugin.Service, "buff.account")
  yield* BuffAccount.Plugin.effect(host)
  return host
})

const signedIn = (deviceID: string, over: Partial<{ access: string; refresh: string; expires: number }> = {}) =>
  Effect.gen(function* () {
    return yield* (yield* Credential.Service).create({
      integrationID: BuffAccount.integrationID,
      value: Credential.OAuth.make({
        type: "oauth",
        methodID: BuffAccount.codeMethodID,
        access: over.access ?? "acc-1",
        refresh: over.refresh ?? jwt({ jti: "r1" }),
        expires: over.expires ?? Date.now() + 15 * 60_000,
        metadata: { deviceID, login: "ivan", host: HOST },
      }),
    })
  })

function eventually<A, E>(
  effect: Effect.Effect<A, E>,
  done: (a: A) => boolean,
  left = 2000,
): Effect.Effect<A, E | Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (done(value)) return value
    if (left === 0) return yield* Effect.fail(new Error("timed out"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, done, left - 1)
  })
}

describe("BuffAccount (#966)", () => {
  it.live("registers «Аккаунт Buff» beside the company sign-in, with a browser and a paste method", () =>
    withSite(
      site(),
      Effect.gen(function* () {
        yield* addPlugin()
        const account = yield* (yield* Integration.Service).get(BuffAccount.integrationID)
        expect(account?.name).toBe("Аккаунт Buff")
        expect(
          account?.methods.flatMap((method) => (method.type === "oauth" ? [String(method.id)] : [])).toSorted(),
        ).toEqual(["browser", "code"])
      }),
    ),
  )

  it.live(
    "paste sign-in: the page gets the challenge, state and device key; the pasted code is redeemed with the verifier",
    () => {
      const made = site()
      return withSite(
        made,
        Effect.gen(function* () {
          const host = yield* addPlugin()
          const integrations = yield* Integration.Service
          const attempt = yield* integrations.oauth.connect({
            integrationID: BuffAccount.integrationID,
            methodID: BuffAccount.codeMethodID,
          })
          expect(attempt.mode).toBe("code")
          const url = new URL(attempt.url)
          expect(url.origin + url.pathname).toBe("https://code.buff.systems/authorize")
          expect(url.searchParams.get("return")).toBe("paste")
          expect(url.searchParams.has("port")).toBe(false)
          const challenge = url.searchParams.get("challenge")!
          const state = url.searchParams.get("state")!
          expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
          expect(
            createPublicKey({
              key: Buffer.from(url.searchParams.get("pubkey")!, "base64url"),
              format: "der",
              type: "spki",
            }).asymmetricKeyType,
          ).toBe("ed25519")
          // Сервер до разрешения ничего не слышал.
          expect(made.of("account_token")).toEqual([])

          yield* integrations.oauth.complete({
            integrationID: BuffAccount.integrationID,
            attemptID: attempt.attemptID,
            code: ` bufa_0123456789ABCDEFGHJKMNPQRS#${state}\n`,
          })
          const [redeemed] = made.of("account_token")
          expect(redeemed).toMatchObject({ code: "bufa_0123456789ABCDEFGHJKMNPQRS", lang: "ru" })
          // Проверочная строка — та, чей отпечаток видела страница; state серверу не уходит.
          expect(createHash("sha256").update(String(redeemed!.verifier)).digest("base64url")).toBe(challenge)
          expect(JSON.stringify(redeemed)).not.toContain(state)

          const saved = (yield* (yield* Credential.Service).list(BuffAccount.integrationID))[0]?.value
          expect(saved).toMatchObject({
            type: "oauth",
            methodID: "code",
            access: jwt({ sub: "ivan" }),
            refresh: jwt({ jti: "r1" }),
            expires: 2_000_000_000_000,
            metadata: { deviceID: "dev_1", login: "ivan", host: HOST },
          })
          // Ключ устройства — в хранилище плагина, не в учётных данных; это тот ключ, что видела страница.
          expect(JSON.stringify(saved)).not.toContain("deviceKey")
          const kept = (yield* host.storage.get(BuffLogin.deviceSlot("dev_1"))) as { deviceKey: string }
          const pub = createPublicKey(
            createPrivateKey({ key: Buffer.from(kept.deviceKey, "base64url"), format: "der", type: "pkcs8" }),
          )
          expect(pub.export({ type: "spki", format: "der" }).toString("base64url")).toBe(
            url.searchParams.get("pubkey")!,
          )
          expect((yield* integrations.get(BuffAccount.integrationID))?.connections[0]).toMatchObject({ label: "ivan" })
        }),
      )
    },
  )

  it.live("a pasted code with a foreign state is not redeemed", () => {
    const made = site()
    return withSite(
      made,
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        const attempt = yield* integrations.oauth.connect({
          integrationID: BuffAccount.integrationID,
          methodID: BuffAccount.codeMethodID,
        })
        const error = yield* integrations.oauth
          .complete({
            integrationID: BuffAccount.integrationID,
            attemptID: attempt.attemptID,
            code: "bufa_X#someone-elses-state",
          })
          .pipe(Effect.flip)
        expect(error.message).toBe("Этот код — от другой попытки входа. Начните вход заново и вставьте новый код.")
        expect(made.of("account_token")).toEqual([])
        expect(yield* (yield* Credential.Service).list(BuffAccount.integrationID)).toEqual([])
      }),
    )
  })

  it.live("the server's refusal of a code reaches the person in its own words", () => {
    const refusal = "Код входа недействителен или истёк — начните вход заново."
    const made = site({ account_token: () => ({ ok: false, error: refusal }) })
    return withSite(
      made,
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        const attempt = yield* integrations.oauth.connect({
          integrationID: BuffAccount.integrationID,
          methodID: BuffAccount.codeMethodID,
        })
        const state = new URL(attempt.url).searchParams.get("state")!
        const error = yield* integrations.oauth
          .complete({ integrationID: BuffAccount.integrationID, attemptID: attempt.attemptID, code: `bufa_X#${state}` })
          .pipe(Effect.flip)
        expect(error.message).toBe(refusal)
        // Код одноразовый: обмен не повторяется.
        expect(made.of("account_token")).toHaveLength(1)
      }),
    )
  })

  it.live("browser sign-in: the page returns the code to 127.0.0.1; a foreign state is ignored", () => {
    const made = site()
    return withSite(
      made,
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        const attempt = yield* integrations.oauth.connect({
          integrationID: BuffAccount.integrationID,
          methodID: BuffAccount.browserMethodID,
        })
        expect(attempt.mode).toBe("auto")
        const url = new URL(attempt.url)
        expect(url.searchParams.get("return")).toBe("loopback")
        const port = Number(url.searchParams.get("port"))
        expect(port).toBeGreaterThanOrEqual(1024)
        const state = url.searchParams.get("state")!
        const back = (query: string, method = "GET") =>
          Effect.promise(() => fetch(`http://127.0.0.1:${port}${query}`, { method }))

        expect((yield* back("/callback?code=bufa_EVIL&state=not-ours")).status).toBe(404)
        expect((yield* back("/")).status).toBe(404)
        expect((yield* back(`/callback?code=bufa_EVIL&state=${state}`, "POST")).status).toBe(404)
        expect(made.of("account_token")).toEqual([])
        expect(
          (yield* integrations.oauth.status({ integrationID: BuffAccount.integrationID, attemptID: attempt.attemptID }))
            .status,
        ).toBe("pending")

        const page = yield* back(`/callback?code=bufa_GOOD&state=${encodeURIComponent(state)}`)
        expect(page.status).toBe(200)
        expect(yield* Effect.promise(() => page.text())).toContain("Вход в Buff Code выполнен")
        yield* eventually(
          integrations.oauth.status({ integrationID: BuffAccount.integrationID, attemptID: attempt.attemptID }),
          (status) => status.status === "complete",
        )
        expect(made.of("account_token")).toMatchObject([{ code: "bufa_GOOD" }])
        expect((yield* (yield* Credential.Service).list(BuffAccount.integrationID))[0]?.value).toMatchObject({
          methodID: "browser",
        })
      }),
    )
  })

  it.live("«Отклонить» on the page ends the sign-in with plain words", () =>
    withSite(
      site(),
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        const attempt = yield* integrations.oauth.connect({
          integrationID: BuffAccount.integrationID,
          methodID: BuffAccount.browserMethodID,
        })
        const url = new URL(attempt.url)
        yield* Effect.promise(() =>
          fetch(
            `http://127.0.0.1:${url.searchParams.get("port")}/callback?error=access_denied&state=${url.searchParams.get("state")}`,
          ),
        )
        const status = yield* eventually(
          integrations.oauth.status({ integrationID: BuffAccount.integrationID, attemptID: attempt.attemptID }),
          (s) => s.status !== "pending",
        )
        expect(status).toMatchObject({ status: "failed", message: "Вход отклонён на странице." })
      }),
    ),
  )

  it.live(
    "refresh is signed by the device key over developer-refresh:<device>:<jti>; a spent token is never sent twice",
    () => {
      const made = site({
        developer_refresh: () => ({
          ok: true,
          access: "acc-2",
          refresh: jwt({ jti: "r2" }),
          exp: 2_000_000_100,
          device_id: "dev_7",
        }),
      })
      return withSite(
        made,
        Effect.gen(function* () {
          const host = yield* addPlugin()
          const key = BuffLogin.newDeviceKey()
          yield* host.storage.set(BuffLogin.deviceSlot("dev_7"), { deviceKey: key.deviceKey })
          const credential = Credential.OAuth.make({
            type: "oauth",
            methodID: BuffAccount.codeMethodID,
            access: "acc-1",
            refresh: jwt({ jti: "r1-seven" }),
            expires: 0,
            metadata: { deviceID: "dev_7", login: "ivan", host: HOST },
          })
          const [first, second] = yield* Effect.all(
            [BuffAccount.refresh(host.storage, credential), BuffAccount.refresh(host.storage, credential)],
            {
              concurrency: 2,
            },
          )
          expect(first).toMatchObject({
            access: "acc-2",
            refresh: jwt({ jti: "r2" }),
            expires: 2_000_000_100_000,
            metadata: { deviceID: "dev_7", login: "ivan", host: HOST },
          })
          // Опоздавший получает уже выданную пару: старый токен обновления второй раз не уходит.
          expect(second).toEqual(first)
          const sent = made.of("developer_refresh")
          expect(sent).toHaveLength(1)
          expect(sent[0]!.refresh).toBe(credential.refresh)
          const pub = createPublicKey({ key: Buffer.from(key.pubkey, "base64url"), format: "der", type: "spki" })
          expect(
            verify(
              null,
              Buffer.from("developer-refresh:dev_7:r1-seven"),
              pub,
              Buffer.from(String(sent[0]!.sig), "base64url"),
            ),
          ).toBe(true)
        }),
      )
    },
  )

  it.live("a revoked device is told in the server's words; a sign-in without its key says to sign in again", () => {
    const made = site({ developer_refresh: () => ({ ok: false, error: "Устройство отозвано — войдите заново." }) })
    return withSite(
      made,
      Effect.gen(function* () {
        const host = yield* addPlugin()
        const credential = (deviceID: string) =>
          Credential.OAuth.make({
            type: "oauth",
            methodID: BuffAccount.codeMethodID,
            access: "a",
            refresh: jwt({ jti: `r-${deviceID}` }),
            expires: 0,
            metadata: { deviceID, host: HOST },
          })
        yield* host.storage.set(BuffLogin.deviceSlot("dev_8"), { deviceKey: BuffLogin.newDeviceKey().deviceKey })
        expect((yield* BuffAccount.refresh(host.storage, credential("dev_8")).pipe(Effect.flip)).message).toBe(
          "Устройство отозвано — войдите заново.",
        )
        expect((yield* BuffAccount.refresh(host.storage, credential("dev_nokey")).pipe(Effect.flip)).message).toBe(
          "Вход повреждён — войдите заново.",
        )
      }),
    )
  })

  it.live("the subscription's tiers are the models: tier names only, the default tier first", () => {
    const made = site()
    return withSite(
      made,
      Effect.gen(function* () {
        yield* signedIn("dev_2")
        yield* addPlugin()
        const models = yield* Model.Service
        const optimal = yield* models.get(BuffAccount.providerID, Model.ID.make("optimal"))
        const fast = yield* models.get(BuffAccount.providerID, Model.ID.make("fast"))
        expect(made.of("chat_models")).toMatchObject([{ token: "acc-1", lang: "ru" }])
        expect(optimal).toMatchObject({
          name: "Оптимальная",
          capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
          cost: [],
          variants: [],
        })
        expect(optimal?.limit.context).toBe(400_000)
        expect(fast).toMatchObject({ name: "Быстрая", limit: { context: 200_000, output: 16_384 } })
        // Пределы — те, что назвал сервер: своего потолка запроса Buff Code не добавляет.
        expect(optimal?.limit.input).toBeUndefined()
        expect(Date.now() - (fast?.time.released ?? 0)).toBeLessThan(60_000)
        expect(yield* (yield* Provider.Service).get(BuffAccount.providerID)).toMatchObject({
          name: "Подписка Buff",
          integrationID: "buff-account",
          package: "@opencode/ai/providers/openai-compatible",
        })
      }),
    )
  })

  it.live(
    "a model request leaves as the chat_model_call command with the person's token, and comes back as the HTTP answer",
    () => {
      const made = site()
      return withSite(
        made,
        Effect.gen(function* () {
          yield* signedIn("dev_9", { access: "acc-9" })
          yield* addPlugin()
          const answer = BuffProviderFetch.get(BuffAccount.providerID)
          expect(answer).toBeDefined()
          const body = { model: "fast", stream: true, messages: [{ role: "user", content: "привет" }] }
          const response = yield* Effect.promise((signal) =>
            answer!(
              new Request("https://account.buff.invalid/v1/chat/completions", {
                method: "POST",
                headers: { "X-Buff-Session": "ses_1", "X-Buff-Call": "primary" },
                body: JSON.stringify(body),
              }),
              signal,
            ),
          )
          expect(response.status).toBe(200)
          expect(response.headers.get("content-type")).toBe("text/event-stream")
          expect(yield* Effect.promise(() => response.text())).toBe('data: {"model":"fast"}\n\ndata: [DONE]\n\n')
          expect(made.of("chat_model_call")).toEqual([
            {
              tier: "fast",
              path: "chat/completions",
              body,
              session: "ses_1",
              call: "primary",
              token: "acc-9",
              lang: "ru",
            },
          ])
        }),
      )
    },
  )

  it.live(
    "the install's own limits rule a large request: over its body ceiling nothing is sent, and the person reads the ceiling",
    () => {
      const made = site({
        chat_models: () => ({
          ...TIERS,
          request: { max_bytes: 2_097_152, piece_bytes: 300_000, max_pieces: 8, finish_seconds: 60 },
        }),
      })
      return withSite(
        made,
        Effect.gen(function* () {
          yield* signedIn("dev_13")
          yield* addPlugin()
          const send = (bytes: number) =>
            Effect.promise((signal) =>
              BuffProviderFetch.get(BuffAccount.providerID)!(
                new Request("https://account.buff.invalid/v1/chat/completions", {
                  method: "POST",
                  body: JSON.stringify({ model: "fast", messages: [{ role: "user", content: "x".repeat(bytes) }] }),
                }),
                signal,
              ),
            )
          // 1,2 МБ не умещается в сообщение: части — по размеру, который назвала установка.
          expect((yield* send(1_200_000)).status).toBe(200)
          const pieces = made.of("chat_model_part")
          expect(pieces.map((piece) => piece.chunk)).toMatchObject([
            { seq: 0, of: 5 },
            { seq: 1, of: 5 },
            { seq: 2, of: 5 },
            { seq: 3, of: 5 },
            { seq: 4, of: 5 },
          ])
          expect(Buffer.from(String(pieces[0]!.data), "base64").length).toBe(300_000)
          expect(made.of("chat_model_call")).toMatchObject([{ upload: (pieces[0]!.chunk as { id: string }).id }])
          // Больше потолка установки — ничего не уходит, человеку названа её граница.
          const refused = yield* send(2_200_000)
          expect(refused.status).toBe(413)
          expect(((yield* Effect.promise(() => refused.json())) as { error: { message: string } }).error.message).toBe(
            "Запрос к модели слишком большой (максимум 2 МБ). Сократите контекст или уберите часть вложений.",
          )
          expect(made.of("chat_model_part")).toHaveLength(5)
        }),
      )
    },
  )

  it.live("without a sign-in a model request is refused in plain words, not sent", () => {
    const made = site()
    return withSite(
      made,
      Effect.gen(function* () {
        yield* addPlugin()
        const response = yield* Effect.promise((signal) =>
          BuffProviderFetch.get(BuffAccount.providerID)!(
            new Request("https://account.buff.invalid/v1/chat/completions", {
              method: "POST",
              body: '{"model":"fast"}',
            }),
            signal,
          ),
        )
        expect(response.status).toBe(401)
        expect(response.headers.get("x-should-retry")).toBe("false")
        expect(((yield* Effect.promise(() => response.json())) as { error: { message: string } }).error.message).toBe(
          "Вход в аккаунт Buff не выполнен.",
        )
        expect(made.of("chat_model_call")).toEqual([])
      }),
    )
  })

  it.live("a change of language renames the tiers, the provider and the sign-in at once", () => {
    const made = site()
    return withSite(
      made,
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* BuffLocale.Plugin.effect(yield* PluginHost.make(plugins, "buff.locale"))
        yield* signedIn("dev_12")
        yield* addPlugin()
        const models = yield* Model.Service
        const locale = (yield* Rpc.Service).client(BuffLocaleSchema.Rpc)
        expect((yield* models.get(BuffAccount.providerID, Model.ID.make("fast")))?.name).toBe("Быстрая")
        yield* locale.set("en")
        yield* eventually(models.get(BuffAccount.providerID, Model.ID.make("fast")), (model) => model?.name === "Fast")
        expect((yield* (yield* Provider.Service).get(BuffAccount.providerID))?.name).toBe("Buff subscription")
        yield* eventually(
          (yield* Integration.Service).get(BuffAccount.integrationID),
          (item) => item?.name === "Buff account",
        )
        yield* locale.set("ru")
        yield* eventually(
          models.get(BuffAccount.providerID, Model.ID.make("fast")),
          (model) => model?.name === "Быстрая",
        )
      }),
    )
  })

  it.live(
    "a subscription that ended or was blocked keeps its tiers: a request reaches the server and the person reads its refusal",
    () => {
      let status = "active"
      const made = site({
        chat_models: () =>
          status === "active"
            ? TIERS
            : { ok: true, tiers: [], default: null, small: null, subscription: { ...TIERS.subscription, status } },
      })
      return withSite(
        made,
        Effect.gen(function* () {
          yield* signedIn("dev_14")
          const plugins = yield* Plugin.Service
          const host = yield* PluginHost.make(plugins, "buff.account")
          yield* BuffAccount.Plugin.effect(host)
          const models = yield* Model.Service
          expect((yield* models.get(BuffAccount.providerID, Model.ID.make("fast")))?.name).toBe("Быстрая")
          // Следующий запуск: подписку заблокировали — сервер уровней больше не называет.
          status = "blocked"
          yield* BuffAccount.Plugin.effect(yield* PluginHost.make(plugins, "buff.account"))
          yield* (yield* Provider.Service).reload()
          expect((yield* models.get(BuffAccount.providerID, Model.ID.make("fast")))?.name).toBe("Быстрая")
          expect((yield* models.get(BuffAccount.providerID, Model.ID.make("optimal")))?.name).toBe("Оптимальная")
        }),
      )
    },
  )

  it.live("without a sign-in or without an active subscription there is no provider", () => {
    const made = site({
      chat_models: () => ({ ok: true, tiers: [], default: null, small: null, subscription: { status: "none" } }),
    })
    return withSite(
      made,
      Effect.gen(function* () {
        yield* addPlugin()
        expect(yield* (yield* Provider.Service).get(BuffAccount.providerID)).toBeUndefined()
        expect(made.seen).toEqual([])
        yield* signedIn("dev_3")
        yield* eventually(
          Effect.sync(() => made.of("chat_models").length),
          (n) => n > 0,
        )
        yield* Effect.promise(() => Bun.sleep(20))
        expect(yield* (yield* Provider.Service).get(BuffAccount.providerID)).toBeUndefined()
      }),
    )
  })

  it.live("usage: the subscription's windows, read with the person's own token", () => {
    const made = site({
      chat_usage: () => ({
        ok: true,
        subscription: TIERS.subscription,
        windows: [
          { id: "5h", used_pct: 12, reset_at: "2026-11-24T12:30:00Z" },
          { id: "week", used_pct: 40, reset_at: null },
        ],
      }),
    })
    return withSite(
      made,
      Effect.gen(function* () {
        yield* addPlugin()
        const rpc = (yield* Rpc.Service).client(BuffSubscription.Rpc)
        expect(yield* rpc.get().pipe(Effect.flip)).toMatchObject({ type: "signed_out" })
        yield* signedIn("dev_4")
        expect(yield* rpc.get()).toEqual({
          login: "ivan",
          plan: { status: "active", name: "Средний", nameEn: "Plus", activeUntil: null },
          windows: [
            { id: "5h", usedPct: 12, resetAt: "2026-11-24T12:30:00Z" },
            { id: "week", usedPct: 40, resetAt: null },
          ],
        })
        expect(made.of("chat_usage")).toMatchObject([{ token: "acc-1" }])
      }),
    )
  })

  it.live("usage: the server's refusal is told as it is", () => {
    const made = site({ chat_usage: () => ({ ok: false, error: "chat machine: too many requests" }) })
    return withSite(
      made,
      Effect.gen(function* () {
        yield* signedIn("dev_5")
        yield* addPlugin()
        const error = yield* (yield* Rpc.Service).client(BuffSubscription.Rpc).get().pipe(Effect.flip)
        expect(error).toMatchObject({ type: "unreachable" })
        expect(String((error as { message?: unknown }).message)).toContain("chat machine: too many requests")
      }),
    )
  })

  it.live("a device revoked elsewhere: the stored sign-in is removed and the person is told in plain words", () => {
    const made = site({ chat_usage: () => ({ ok: false, error: "Устройство отозвано — войдите заново." }) })
    return withSite(
      made,
      Effect.gen(function* () {
        yield* signedIn("dev_10")
        const host = yield* addPlugin()
        yield* host.storage.set(BuffLogin.deviceSlot("dev_10"), { deviceKey: BuffLogin.newDeviceKey().deviceKey })
        const error = yield* (yield* Rpc.Service).client(BuffSubscription.Rpc).get().pipe(Effect.flip)
        expect(error).toMatchObject({ type: "signed_out" })
        expect(String((error as { message?: unknown }).message)).toBe(
          "Вход в аккаунт Buff на этом компьютере завершён: устройство отозвано на сайте или вход выполнен заново. Войдите ещё раз.",
        )
        expect(yield* (yield* Credential.Service).list(BuffAccount.integrationID)).toEqual([])
        yield* eventually(host.storage.get(BuffLogin.deviceSlot("dev_10")), (kept) => kept === undefined)
        // Сервер уже отозвал устройство: сообщать ему о выходе незачем.
        yield* Effect.promise(() => Bun.sleep(20))
        expect(made.of("developer_signout")).toEqual([])
        // Уровни подписки ушли вместе со входом.
        yield* eventually((yield* Provider.Service).get(BuffAccount.providerID), (provider) => provider === undefined)
      }),
    )
  })

  it.live(
    "a model request from a revoked device: one refresh is tried, the sign-in is removed, the refusal says what to do",
    () => {
      const revoked = "The device was revoked — sign in again."
      const made = site({ developer_refresh: () => ({ ok: false, error: revoked }) })
      Object.assign(made.link, {
        stream: async function* () {
          yield new Uint8Array(
            Buffer.from(
              `{"status":401,"content_type":"application/json"}\n{"error":{"message":"${revoked}","type":"invalid_token","code":401}}`,
            ),
          )
        },
      })
      return withSite(
        made,
        Effect.gen(function* () {
          yield* signedIn("dev_11")
          const host = yield* addPlugin()
          yield* host.storage.set(BuffLogin.deviceSlot("dev_11"), { deviceKey: BuffLogin.newDeviceKey().deviceKey })
          const response = yield* Effect.promise((signal) =>
            BuffProviderFetch.get(BuffAccount.providerID)!(
              new Request("https://account.buff.invalid/v1/chat/completions", {
                method: "POST",
                body: '{"model":"fast"}',
              }),
              signal,
            ),
          )
          expect(response.status).toBe(401)
          expect(response.headers.get("x-should-retry")).toBe("false")
          expect(((yield* Effect.promise(() => response.json())) as { error: { message: string } }).error.message).toBe(
            "Вход в аккаунт Buff на этом компьютере завершён: устройство отозвано на сайте или вход выполнен заново. Войдите ещё раз.",
          )
          expect(made.of("developer_refresh")).toHaveLength(1)
          expect(yield* (yield* Credential.Service).list(BuffAccount.integrationID)).toEqual([])
        }),
      )
    },
  )

  it.live("sign-out tells the server and deletes the device key", () => {
    const made = site()
    return withSite(
      made,
      Effect.gen(function* () {
        const created = yield* signedIn("dev_6", { access: "acc-out" })
        const host = yield* addPlugin()
        yield* host.storage.set(BuffLogin.deviceSlot("dev_6"), { deviceKey: BuffLogin.newDeviceKey().deviceKey })
        yield* (yield* Credential.Service).remove(created.id)
        yield* eventually(
          Effect.sync(() => made.of("developer_signout").length),
          (n) => n > 0,
        )
        expect(made.of("developer_signout")).toMatchObject([{ token: "acc-out" }])
        yield* eventually(host.storage.get(BuffLogin.deviceSlot("dev_6")), (kept) => kept === undefined)
        // Уровни подписки ушли вместе со входом.
        yield* eventually((yield* Provider.Service).get(BuffAccount.providerID), (provider) => provider === undefined)
      }),
    )
  })
})
