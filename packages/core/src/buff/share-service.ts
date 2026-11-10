export * as BuffShareService from "./share-service.js"

import path from "node:path"
import { Context, Effect, Layer, Stream } from "effect"
import type { Scope } from "effect"
import { RefusalError } from "@buff/mobile-protocol"
import { Global } from "@opencode/util/global"
import { BuffServerAuth } from "@opencode/schema/buff-server-auth"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { BuffShare } from "@opencode/schema/buff-share"
import { Bus } from "../bus.js"
import { BuffLocale } from "./locale.js"
import { BuffMobileService } from "./mobile-service.js"
import { ShareLinks, type CreateInput, type ShareView, type UpdateInput } from "./share/links.js"
import { phoneCommand } from "./share/phone.js"
import { fileShareStore } from "./share/store.js"
import type { StoredMessage } from "./share/document.js"

/**
 * Публичные ссылки Buff Code (#816, эпик #769) — одна служба на машину, в управляемой службе
 * (`buff serve --service`), рядом с телефоном: ссылки объявляются на шлюзе через агента машины, а
 * содержимое отдаётся зрителю шлюза по тому же каналу. Окно, консоль и телефон правят ссылки через
 * RPC `buff.share` и команды `shares.*`. Удалённая сессия кончает свои ссылки сама.
 */

/** Как часто служба доносит до шлюза, что не дошло (объявления, отзывы), пока есть что доносить. */
const SYNC_MS = 60_000
/** Сообщений сессии за один запрос к серверу — страницами до конца. */
const PAGE = 200

const data = <T>(reply: unknown): T => (reply as { data: T }).data

const make = Effect.gen(function* () {
  const bus = yield* Bus.Service
  const mobile = yield* BuffMobileService.Service
  let links: ShareLinks | null = null
  const need = () => {
    if (!links)
      throw new RefusalError(BuffLocale.t("The Buff Code service is not running — public links are made through it."))
    return links
  }
  const log = {
    info: (message: string, fields?: Record<string, unknown>) => Effect.runFork(Effect.logInfo(message, fields ?? {})),
    warn: (message: string, fields?: Record<string, unknown>) =>
      Effect.runFork(Effect.logWarning(message, fields ?? {})),
    error: (message: string, fields?: Record<string, unknown>) =>
      Effect.runFork(Effect.logError(message, fields ?? {})),
  }
  return {
    status: async (): Promise<BuffShare.Status> => ({
      gateway: mobile.gateway.host(),
      connected: mobile.gateway.connected(),
      problem: mobile.gateway.problem(),
      running: links !== null,
    }),
    list: (): Promise<ShareView[]> => need().list(),
    create: (input: CreateInput): Promise<ShareView> => need().create(input),
    update: (id: string, patch: UpdateInput): Promise<ShareView> => need().update(id, patch),
    remove: (id: string): Promise<void> => need().remove(id),
    boot: (server: { url: string; password: string }) =>
      Effect.acquireRelease(
        Effect.promise(async () => {
          const call = loopback(server.url, server.password)
          const made = new ShareLinks({
            store: fileShareStore(path.join(Global.Path.config, "share")),
            gatewayHost: mobile.gateway.host(),
            publish: async (id, expiresAt) =>
              (await mobile.gateway.command("share_publish", { id, ...(expiresAt ? { expiresAt } : {}) })).ok,
            revoke: async (id) => (await mobile.gateway.command("share_revoke", { id })).ok,
            session: async (id) => {
              try {
                const info = data<{ title?: string } | null>(await call("GET", `/api/session/${id}`))
                if (!info) return null
                // Whether a turn runs on it now (#823): the same list the window and the phone read.
                const active =
                  data<Record<string, unknown>>(await call("GET", "/api/session/active").catch(() => ({ data: {} }))) ??
                  {}
                return { title: info.title ?? "", active: id in active }
              } catch (err) {
                if (err instanceof RefusalError) return null
                throw err
              }
            },
            messages: (session) => allMessages(call, session),
            now: () => Date.now(),
            log,
          })
          links = made
          mobile.shares({
            serve: (op, args) => made.serve(op, args),
            phone: (op, args) => phoneCommand(made, op, args),
          })
          // Ссылки есть — связь со шлюзом нужна и без телефонов: зритель должен нас найти.
          if (await made.hasActive())
            await mobile.gateway
              .connect()
              .catch((err: unknown) => log.warn("share: gateway not connected", { err: String(err) }))
          const sync = () =>
            made
              .pending()
              .then((yes) => (yes ? made.sync() : undefined))
              .catch((err: unknown) => log.warn("share: sync failed", { err: String(err) }))
          void sync()
          return { timer: setInterval(() => void sync(), SYNC_MS) }
        }),
        ({ timer }) =>
          Effect.sync(() => {
            clearInterval(timer)
            mobile.shares(null)
            links = null
          }),
      ).pipe(
        Effect.andThen(
          Effect.forkScoped(
            bus.subscribe().pipe(
              Stream.runForEach((event) =>
                Effect.promise(async () => {
                  if (event.type !== "session.deleted" || !links) return
                  const id = (event.data as { sessionID?: unknown } | null)?.sessionID
                  if (typeof id === "string")
                    await links
                      .sourceDeleted(id)
                      .catch((err: unknown) => log.warn("share: cascade failed", { err: String(err) }))
                }),
              ),
            ),
          ),
        ),
        Effect.asVoid,
      ),
  }
})

/** Запрос к своему серверу по петле — тот же, что у службы телефона. */
type Call = (
  method: "GET",
  route: string,
  options?: { query?: Record<string, string | number | undefined> },
) => Promise<unknown>

function loopback(url: string, password: string): Call {
  const auth = `Basic ${Buffer.from(`${BuffServerAuth.USERNAME}:${password}`).toString("base64")}`
  return async (method, route, options) => {
    const target = new URL(route, url)
    for (const [k, v] of Object.entries(options?.query ?? {}))
      if (v !== undefined) target.searchParams.set(k, String(v))
    const res = await fetch(target, { method, headers: { authorization: auth } })
    const text = await res.text()
    const body = text ? (JSON.parse(text) as unknown) : null
    if (res.status >= 400 && res.status < 500) throw new RefusalError(`server ${res.status}`)
    if (!res.ok) throw new Error(`server ${res.status}`)
    return body
  }
}

/** Все сообщения сессии по порядку: сервер отдаёт страницами по курсору. */
async function allMessages(call: Call, session: string): Promise<StoredMessage[]> {
  const out: StoredMessage[] = []
  let cursor: string | undefined
  for (;;) {
    const page = (await call("GET", `/api/session/${session}/message`, {
      query: { limit: PAGE, ...(cursor ? { cursor } : { order: "asc" }) },
    })) as { data?: StoredMessage[]; cursor?: { next?: string } } | StoredMessage[]
    const items = Array.isArray(page) ? page : (page.data ?? [])
    out.push(...items)
    const next = Array.isArray(page) ? undefined : page.cursor?.next
    if (!next || items.length < PAGE) return out
    cursor = next
  }
}

type Made = Effect.Success<typeof make>
export type Interface = Omit<Made, "boot"> & {
  /** Поднять службу ссылок — только в управляемой службе (одна на машину). */
  readonly start: (server: { url: string; password: string }) => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@buff/ShareService") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { boot, ...service } = yield* make
    return Service.of({ ...service, start: boot })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Bus.node, BuffMobileService.node] })
