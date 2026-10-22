// Вход разработчика в Buff Code (#366): через коннектор компании, ключ и токены — на машине.
import { describe, expect } from "bun:test"
import { createPrivateKey, createPublicKey, verify } from "node:crypto"
import { Effect, Layer } from "effect"
import type { StorageDomain } from "@opencode/plugin/effect/storage"
import { FetchHttpClient } from "effect/unstable/http"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { BuffLogin } from "@opencode/core/buff/login"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("buff")
const methodID = Integration.MethodID.make("device")

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* BuffLogin.Plugin.effect(host)
  return host
})

/** The plugin's own storage, as the refresh reads it. */
function memoryStorage(entries: Record<string, unknown> = {}): StorageDomain {
  const map = new Map(Object.entries(entries))
  return {
    get: (key) => Effect.sync(() => map.get(key) as never),
    set: (key, value) => Effect.sync(() => void map.set(key, value)),
    remove: (key) => Effect.sync(() => void map.delete(key)),
    scan: () => Effect.die("not used"),
  }
}

const jwt = (payload: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`

/** A connector's developer gateway: answers as the real one relays the backend. */
function gateway(poll: Array<Record<string, unknown>>) {
  const seen: Array<{ path: string; body: Record<string, unknown> }> = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      const body = (await request.json()) as Record<string, unknown>
      seen.push({ path, body })
      if (path === "/v1/developer/device/start")
        return Response.json({
          ok: true,
          device_code: "bufd_X",
          user_code: "KRCJ-CTPW",
          verification_uri: "https://buff.systems/app/device",
          expires_in: 300,
          interval: 0,
        })
      if (path === "/v1/developer/device/poll") return Response.json(poll.shift() ?? { ok: true, status: "unknown" })
      return Response.json({ ok: false, error: "нет такого адреса" }, { status: 404 })
    },
  })
  return { server, seen }
}

const approved = {
  ok: true,
  status: "approved",
  org: "acme",
  device_id: "dev_1",
  access: jwt({ sub: "ivan", orgs: ["acme", "retail"] }),
  refresh: jwt({ jti: "r1" }),
  exp: 2_000_000_000,
}

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

describe("BuffLogin (#366)", () => {
  it.effect("registers Buff with a sign-in that asks for the company's connector", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const buff = yield* (yield* Integration.Service).get(integrationID)
      expect(buff?.name).toBe("Buff")
      const method = buff?.methods[0]
      expect(method?.type).toBe("oauth")
      if (method?.type !== "oauth") return
      expect(method.form?.[0]).toMatchObject({ key: "connector", type: "string", required: true })
      // Адрес проверяет сам вход и отвечает своими словами (#458): общая проверка формы
      // говорит только «Expected URI for form field».
      expect(method.form?.[0]).not.toHaveProperty("format")
    }),
  )

  it.live("signs in through the connector: the code is shown, the cabinet approves, the tokens are kept", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => gateway([{ ok: true, status: "pending" }, approved])),
      ({ server, seen }) =>
        Effect.gen(function* () {
          const host = yield* addPlugin()
          const integrations = yield* Integration.Service
          const attempt = yield* integrations.oauth.connect({
            integrationID,
            methodID,
            answer: { connector: `${server.url.origin}///` },
          })
          expect(attempt.url).toBe("https://buff.systems/app/device?code=KRCJ-CTPW")
          expect(attempt.instructions).toContain("KRCJ-CTPW")
          // #457: срок кода — тот, что назвал бэкенд (300 с), чтобы окно показало, сколько осталось.
          expect(attempt.time.expires - Date.now()).toBeGreaterThan(290_000)
          expect(attempt.time.expires - Date.now()).toBeLessThanOrEqual(300_000)
          yield* eventually(
            integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }),
            (s) => s.status === "complete",
          )

          const start = seen[0]
          expect(start.path).toBe("/v1/developer/device/start")
          expect(typeof start.body.device_name).toBe("string")
          const key = createPublicKey({
            key: Buffer.from(String(start.body.pubkey), "base64url"),
            format: "der",
            type: "spki",
          })
          expect(key.asymmetricKeyType).toBe("ed25519")
          expect(seen.filter((s) => s.path === "/v1/developer/device/poll").map((s) => s.body)).toEqual([
            { device_code: "bufd_X" },
            { device_code: "bufd_X" },
          ])

          const saved = (yield* (yield* Credential.Service).list(integrationID))[0]?.value
          expect(saved).toMatchObject({
            type: "oauth",
            access: approved.access,
            refresh: approved.refresh,
            expires: approved.exp * 1000,
            metadata: {
              connector: server.url.origin,
              deviceID: "dev_1",
              login: "ivan",
              org: "acme",
              orgs: ["acme", "retail"],
            },
          })
          // The device key never rides in the credential: its metadata reaches the provider's
          // settings (#370). It is kept in the plugin's storage, and it is the key that signed up.
          expect(Object.keys(saved?.metadata ?? {})).not.toContain("deviceKey")
          const kept = (yield* host.storage.get(BuffLogin.deviceSlot("dev_1"))) as { deviceKey: string }
          const pub = createPublicKey(
            createPrivateKey({ key: Buffer.from(kept.deviceKey, "base64url"), format: "der", type: "pkcs8" }),
          )
          expect(pub.export({ type: "spki", format: "der" }).toString("base64url")).toBe(String(start.body.pubkey))
          const buff = yield* integrations.get(integrationID)
          expect(buff?.connections[0]).toMatchObject({ label: "ivan · acme" })
          // #470: после выхода вход не просит адрес заново — форма помнит коннектор.
          const method = buff?.methods[0]
          if (method?.type !== "oauth") throw new Error("no oauth method")
          expect(method.form?.[0]).toMatchObject({ key: "connector", default: server.url.origin })
          expect(method.form?.[0]).not.toHaveProperty("hidden")
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  // #458: причина отказа названа словами, по которым понятно, что исправить.
  it.effect("a failure of the connector reads as what to check, not as a transport error", () =>
    Effect.sync(() => {
      const at = "https://connector.acme.local:8767"
      expect(BuffLogin.connectorFailure(at, { kind: "transport" })).toBe(
        `Коннектор по адресу ${at} не отвечает. Проверьте адрес и подключение к сети компании.`,
      )
      for (const reply of [
        { kind: "reply", status: 404, error: "нет такого адреса" },
        { kind: "reply", status: 405 },
        { kind: "reply", status: 200, html: true },
      ] as const)
        expect(BuffLogin.connectorFailure(at, reply)).toBe(
          `По адресу ${at} отвечает не коннектор Buff. Адрес коннектора показан в кабинете, в разделе «Коннекторы».`,
        )
      // Отказ самого бэкенда приходит его словами.
      expect(BuffLogin.connectorFailure(at, { kind: "reply", status: 403, error: "Устройство отозвано" })).toBe(
        "Устройство отозвано",
      )
      expect(BuffLogin.connectorFailure(at, { kind: "reply", status: 502 })).toBe(
        `Коннектор по адресу ${at} ответил ошибкой 502. Повторите позже или обратитесь к администратору.`,
      )
    }),
  )

  const failedSignIn = (connector: string) =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const failure = yield* integrations.oauth
        .connect({ integrationID, methodID, answer: { connector } })
        .pipe(Effect.flip)
      return String((failure as { message?: string }).message ?? failure)
    })

  it.live("an address nobody answers at says so, with the address", () =>
    Effect.gen(function* () {
      expect(yield* failedSignIn("http://127.0.0.1:1")).toBe(
        "Коннектор по адресу http://127.0.0.1:1 не отвечает. Проверьте адрес и подключение к сети компании.",
      )
    }),
  )

  it.live("an address of something else says it is not a connector", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => Bun.serve({ port: 0, fetch: () => new Response("<html>hello</html>", { status: 200 }) })),
      (server) =>
        Effect.gen(function* () {
          expect(yield* failedSignIn(server.url.origin)).toContain("отвечает не коннектор Buff")
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("something that is not an address says what an address looks like", () =>
    Effect.gen(function* () {
      expect(yield* failedSignIn("abc")).toBe(
        "Адрес коннектора должен начинаться с https:// — например, https://connector.company.local:8767",
      )
    }),
  )

  it.live("a refusal in the cabinet ends the sign-in with a plain message", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => gateway([{ ok: true, status: "denied" }])),
      ({ server }) =>
        Effect.gen(function* () {
          yield* addPlugin()
          const integrations = yield* Integration.Service
          const attempt = yield* integrations.oauth.connect({
            integrationID,
            methodID,
            answer: { connector: server.url.origin },
          })
          const status = yield* eventually(
            integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }),
            (s) => s.status === "failed",
          )
          expect(status.status === "failed" && status.message).toContain("отклонили")
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("refresh proves the device key; the connector relays it", () =>
    Effect.gen(function* () {
      const pair = BuffLogin.newDeviceKey()
      let sent: Record<string, unknown> = {}
      const server = Bun.serve({
        port: 0,
        fetch: async (request) => {
          sent = (await request.json()) as Record<string, unknown>
          if (new URL(request.url).pathname !== "/v1/developer/refresh") return new Response(null, { status: 404 })
          return Response.json({
            ok: true,
            access: jwt({ sub: "ivan", orgs: ["acme"] }),
            refresh: jwt({ jti: "r2" }),
            exp: 2_100_000_000,
            device_id: "dev_1",
          })
        },
      })
      try {
        const credential = Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: jwt({ sub: "ivan" }),
          refresh: jwt({ jti: "r1" }),
          expires: 0,
          metadata: {
            connector: server.url.origin,
            deviceID: "dev_1",
            login: "ivan",
            org: "acme",
            orgs: ["acme"],
          },
        })
        const storage = memoryStorage({ [BuffLogin.deviceSlot("dev_1")]: { deviceKey: pair.deviceKey } })
        const next = yield* BuffLogin.refresh(storage, credential).pipe(Effect.provide(FetchHttpClient.layer))
        expect(next.expires).toBe(2_100_000_000 * 1000)
        expect(next.metadata).toMatchObject({ deviceID: "dev_1", orgs: ["acme"] })
        expect(Object.keys(next.metadata ?? {})).not.toContain("deviceKey")
        expect(sent.refresh).toBe(credential.refresh)
        const ok = verify(
          null,
          Buffer.from("developer-refresh:dev_1:r1"),
          createPublicKey({ key: Buffer.from(pair.pubkey, "base64url"), format: "der", type: "spki" }),
          Buffer.from(String(sent.sig), "base64url"),
        )
        expect(ok).toBe(true)
      } finally {
        server.stop(true)
      }
    }),
  )

  it.live("a revoked device's refresh fails in the backend's own words", () =>
    Effect.gen(function* () {
      const pair = BuffLogin.newDeviceKey()
      const server = Bun.serve({
        port: 0,
        fetch: () => Response.json({ ok: false, error: "Устройство отозвано — войдите заново." }, { status: 403 }),
      })
      try {
        const credential = Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "a",
          refresh: jwt({ jti: "r1" }),
          expires: 0,
          metadata: { connector: server.url.origin, deviceID: "dev_1" },
        })
        const storage = memoryStorage({ [BuffLogin.deviceSlot("dev_1")]: { deviceKey: pair.deviceKey } })
        const error = yield* BuffLogin.refresh(storage, credential).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.flip,
        )
        expect(String(error)).toContain("Устройство отозвано")
      } finally {
        server.stop(true)
      }
    }),
  )

  it.live("without the device key a refresh asks to sign in again and sends nothing", () =>
    Effect.gen(function* () {
      const credential = Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: "a",
        refresh: jwt({ jti: "r1" }),
        expires: 0,
        metadata: { connector: "http://127.0.0.1:9", deviceID: "dev_1" },
      })
      const error = yield* BuffLogin.refresh(memoryStorage(), credential).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.flip,
      )
      expect(String(error)).toContain("войдите заново")
    }),
  )
})
