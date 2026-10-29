export * as BuffMobileService from "./mobile-service.js"

import os from "node:os"
import path from "node:path"
import { Context, Effect, Layer, Stream } from "effect"
import type { Scope } from "effect"
import { RefusalError, type PairingView, type PeerLog, type RelayConn } from "@buff/mobile-protocol"
import { connect as natsConnect } from "nats.ws"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { MobileAgent, type AgentStatus, type Phone } from "./mobile/agent.js"
import { mobileApi, type Call, type Fetch, type MobileApi, type Terminals } from "./mobile/api.js"
import { lookupHome, type SignedIn } from "./mobile/home.js"
import { machineNotice, noticeKindOf, type NoticeKind } from "./mobile/notify.js"
import { fileStore } from "./mobile/store.js"
import { BuffLocale } from "./locale.js"

/**
 * Телефон для Buff Code (#639) — одна служба на машину: машина становится пиром ретранслятора
 * buff.systems и обслуживает сопряжённые телефоны по E2E-каналу. Работает только в управляемой
 * службе (`buff serve --service`); окно и консоль (#640) говорят с ней через RPC `buff.mobile`.
 */

/** Шлюз: buff.systems; стенд — через BUFF_MOBILE_GATEWAY. */
export const gatewayHost = () => process.env.BUFF_MOBILE_GATEWAY?.trim() || "buff.systems"

const log: PeerLog = {
  info: (message, fields) => Effect.runFork(Effect.logInfo(message, fields ?? {})),
  warn: (message, fields) => Effect.runFork(Effect.logWarning(message, fields ?? {})),
  error: (message, fields) => Effect.runFork(Effect.logError(message, fields ?? {})),
}

/** Запрос к своему серверу по петле — тот же API, что у окна и консоли. */
function loopback(url: string, password: string): Call {
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  return async (method, route, options) => {
    const target = new URL(route, url)
    for (const [k, v] of Object.entries(options?.query ?? {})) if (v !== undefined) target.searchParams.set(k, String(v))
    const res = await fetch(target, {
      method,
      headers: { authorization: auth, ...(options?.body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    })
    const text = await res.text()
    const body = text ? (JSON.parse(text) as unknown) : null
    if (res.status >= 400 && res.status < 500) {
      const message = (body as { message?: string; error?: string } | null)?.message ?? (body as { error?: string } | null)?.error
      throw new RefusalError(message || BuffLocale.t("The request was refused ({status})", { status: res.status }))
    }
    if (!res.ok) throw new Error(`server ${res.status}`)
    return body
  }
}

/** Сырые байты файла с сервера по петле — для `files.read`. */
function loopbackBytes(url: string, password: string): Fetch {
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  return async (route, query) => {
    const target = new URL(route, url)
    for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v)
    const res = await fetch(target, { headers: { authorization: auth } })
    if (!res.ok) throw new Error(`server ${res.status}`)
    return { mime: res.headers.get("content-type") ?? "application/octet-stream", bytes: new Uint8Array(await res.arrayBuffer()) }
  }
}

/**
 * Терминал каталога на телефоне (#653): тот же pty, что у окна (`/api/pty`); служба держит его
 * WebSocket сама и шлёт вывод телефону пушем пачками раз в 100 мс; ввод и размер — командами.
 */
function terminals(server: { url: string; password: string }, call: Call, push: (device: string, record: unknown) => void): Terminals {
  type Open = { ws: WebSocket; pty: string; directory: string; buffer: string; timer?: ReturnType<typeof setTimeout> }
  const open = new Map<string, Open>()
  const key = (device: string, session: string) => `${device}|${session}`
  const flush = (device: string, session: string, t: Open) => {
    t.timer = undefined
    if (!t.buffer) return
    const data = t.buffer
    t.buffer = ""
    push(device, { session, pty: t.pty, data })
  }
  return {
    async open(device, session, directory) {
      const k = key(device, session)
      const was = open.get(k)
      if (was && was.ws.readyState <= 1) return { pty: was.pty }
      const where = { "location[directory]": directory }
      const list = ((await call("GET", "/api/pty", { query: where })) as { data?: { id: string; status: string }[] }).data ?? []
      const pty =
        list.find((p) => p.status === "running")?.id ??
        ((await call("POST", "/api/pty", { query: where, body: { title: BuffLocale.t("Phone") } })) as { data: { id: string } }).data.id
      const auth = `Basic ${Buffer.from(`opencode:${server.password}`).toString("base64")}`
      const ticket = await fetch(new URL(`/api/pty/${pty}/connect-token?location%5Bdirectory%5D=${encodeURIComponent(directory)}`, server.url), {
        method: "POST",
        headers: { authorization: auth, "x-opencode-ticket": "1" },
      }).then((r) => r.json() as Promise<{ data: { ticket: string } }>)
      const target = new URL(`/api/pty/${pty}/connect`, server.url.replace(/^http/, "ws"))
      target.searchParams.set("location[directory]", directory)
      target.searchParams.set("cursor", "-1")
      target.searchParams.set("ticket", ticket.data.ticket)
      const ws = new WebSocket(target, { headers: { origin: server.url } } as unknown as string[])
      ws.binaryType = "arraybuffer"
      const t: Open = { ws, pty, directory, buffer: "" }
      ws.onmessage = (m) => {
        if (typeof m.data !== "string") return // служебный кадр с курсором
        t.buffer += m.data
        t.timer ??= setTimeout(() => flush(device, session, t), 100)
      }
      ws.onclose = () => {
        flush(device, session, t)
        if (open.get(k) === t) open.delete(k)
      }
      open.set(k, t)
      return { pty }
    },
    async input(device, session, text) {
      const t = open.get(key(device, session))
      if (!t || t.ws.readyState !== 1) throw new RefusalError(BuffLocale.t("The terminal is not open"))
      t.ws.send(text)
    },
    async resize(device, session, rows, cols) {
      const t = open.get(key(device, session))
      if (!t || !(rows > 0 && cols > 0)) return
      await call("PUT", `/api/pty/${t.pty}`, { query: { "location[directory]": t.directory }, body: { size: { rows, cols } } })
    },
    close(device, session) {
      open.get(key(device, session))?.ws.close()
      open.delete(key(device, session))
    },
  }
}

const connect = (host: string) => async (token: string): Promise<RelayConn> =>
  (await natsConnect({
    servers: `wss://${host}/nats`,
    token,
    name: "buff-code-machine",
    reconnect: false,
    pingInterval: 20_000,
    maxPingOut: 3,
  })) as unknown as RelayConn

/** Кто из телефонов смотрит какую сессию. */
function watchers() {
  const by = new Map<string, Set<string>>()
  return {
    watch: (device: string, session: string) => void by.set(session, (by.get(session) ?? new Set()).add(device)),
    unwatch: (device: string, session: string) => {
      by.get(session)?.delete(device)
      if (by.get(session)?.size === 0) by.delete(session)
    },
    of: (session: string) => [...(by.get(session) ?? [])],
  }
}

/** Как часто машина сверяет свой дом и его политику (#639): запрет доходит за минуту. */
const HOME_MS = 60_000

const postJson = async (url: string, body: object) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as unknown }
}

// События сессии частые (дельты текста, шаги инструментов): телефону — снимок не чаще раза в 300 мс.
const SETTLE_MS = 300

const make = Effect.gen(function* () {
  const bus = yield* Bus.Service
  let agent: MobileAgent | null = null
  const watches = watchers()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let api: MobileApi | null = null
  let loop: Call | null = null
  // Уведомления телефонам (#636): по сессии и виду — не чаще раза в минуту; смотрящему — нет.
  const told = new Map<string, number>()
  const notice = (kind: NoticeKind, session: string) => {
    const a = agent
    const call = loop
    const now = Math.floor(Date.now() / 1000)
    const key = `${session}|${kind}`
    if (!a?.id || !call || now - (told.get(key) ?? -Infinity) < 60) return
    told.set(key, now)
    for (const [k, at] of told) if (now - at >= 60) told.delete(k)
    void call("GET", `/api/session/${session}`)
      .then((got) => {
        const data = (got as { data?: { title?: unknown; projectID?: unknown } } | null)?.data
        const text = (v: unknown) => (typeof v === "string" ? v : "")
        const message = machineNotice(kind, { id: session, title: text(data?.title), project: text(data?.projectID) }, { id: a.id!, name: os.hostname() }, now)
        return a.notify(message, (device) => watches.of(session).includes(device))
      })
      .catch((err: unknown) => log.warn("mobile: notice not sent", { session, kind, err: String(err) }))
  }
  // Вход в Buff виден каталогам (плагин): каждый открытый каталог даёт, как его прочитать.
  const signIns = new Set<() => Promise<SignedIn | undefined>>()
  const checkHome = async () => {
    if (!agent) return
    let me: SignedIn | undefined
    for (const read of signIns) {
      me = await read().catch(() => undefined)
      if (me) break
    }
    if (!me) return agent.setHome(null)
    // Коннектор молчит — дом прежний: связь вернётся, политика не меняется от обрыва.
    const home = await lookupHome(me, postJson)
    if (home) await agent.setHome(home)
  }
  // Изменение сессии уходит смотрящим её телефонам данными — без «перечитай».
  const changed = (session: string) => {
    if (!watches.of(session).length || timers.has(session)) return
    timers.set(
      session,
      setTimeout(() => {
        timers.delete(session)
        const devices = watches.of(session)
        if (!agent || !api || !devices.length) return
        void api.state(session).then(
          (record) => devices.forEach((device) => agent?.push(device, { kind: "event", stream: "bc.session", record })),
          (err: unknown) => log.warn("mobile: session state not sent", { session, err: String(err) }),
        )
      }, SETTLE_MS),
    )
  }
  const sessionOf = (data: unknown): string | undefined => {
    const id = (data as { sessionID?: unknown } | null)?.sessionID
    return typeof id === "string" ? id : undefined
  }
  const need = () => {
    if (!agent) throw new RefusalError(BuffLocale.t("The Buff Code service is not running — the phone works through it."))
    return agent
  }
  return {
    status: async (): Promise<AgentStatus & { running: boolean }> => {
      if (!agent) return { gateway: gatewayHost(), connected: false, problem: null, phones: 0, home: null, running: false }
      return { ...agent.status((await agent.phones()).length), running: true }
    },
    phones: (): Promise<Phone[]> => need().phones(),
    offer: (kind: "qr" | "code"): Promise<PairingView> => need().offer(kind),
    view: (offerId: string): PairingView => need().view(offerId),
    offers: (): PairingView[] => (agent ? agent.offers() : []),
    confirm: (offerId: string): Promise<PairingView> => need().confirm(offerId),
    cancel: (offerId: string): void => need().cancel(offerId),
    revoke: (device: string): Promise<void> => need().revoke(device),
    rename: (device: string, display: string): Promise<void> => need().rename(device, display),
    /** Каталог с входом в Buff: служба узнаёт по нему дом машины, пока каталог открыт. */
    signIn: (read: () => Promise<SignedIn | undefined>): (() => void) => {
      signIns.add(read)
      void checkHome().catch((err: unknown) => log.warn("mobile: home not checked", { err: String(err) }))
      return () => void signIns.delete(read)
    },
    boot: (server: { url: string; password: string }) =>
      Effect.acquireRelease(
        Effect.promise(async () => {
          const host = gatewayHost()
          const call = loopback(server.url, server.password)
          loop = call
          api = mobileApi(call, watches, {
            fetch: loopbackBytes(server.url, server.password),
            terminals: terminals(server, call, (device, record) =>
              agent?.push(device, { kind: "event", stream: "bc.terminal", record }),
            ),
          })
          const run = api
          agent = new MobileAgent({
            store: fileStore(path.join(Global.Path.config, "mobile")),
            connect: connect(host),
            gatewayHost: host,
            display: () => os.hostname(),
            // Сбой команды телефона — в журнал службы: на телефон он уходит без подробностей.
            exec: (record, op, args) =>
              run.run(record, op, args).catch((err: unknown) => {
                if (!(err instanceof RefusalError)) log.error("mobile: command failed", { op, err: String(err) })
                throw err
              }),
            now: () => Math.floor(Date.now() / 1000),
            log,
          })
          await agent.start().catch((err: unknown) => log.warn("mobile: start failed", { err: String(err) }))
          const check = () => void checkHome().catch((err: unknown) => log.warn("mobile: home not checked", { err: String(err) }))
          check()
          return { agent, timer: setInterval(check, HOME_MS) }
        }),
        ({ agent: a, timer }) =>
          Effect.sync(() => clearInterval(timer)).pipe(
            Effect.andThen(Effect.promise(() => a.stop().catch(() => undefined))),
            Effect.andThen(Effect.sync(() => void (agent = null))),
          ),
      ).pipe(
        Effect.andThen(
          Effect.forkScoped(
            bus.subscribe().pipe(
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  const session = sessionOf(event.data) ?? sessionOf((event.data as { form?: unknown } | null)?.form)
                  if (!session) return
                  changed(session)
                  const kind = noticeKindOf(event.type)
                  if (kind) notice(kind, session)
                }),
              ),
            ),
          ),
        ),
        Effect.asVoid,
      ),
  }
})

type Made = Effect.Success<typeof make>
export type Interface = Omit<Made, "boot"> & {
  /** Поднять мобильный агент — только в управляемой службе (одна на машину). */
  readonly start: (server: { url: string; password: string }) => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@buff/MobileService") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { boot, ...service } = yield* make
    return Service.of({ ...service, start: boot })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Bus.node] })
