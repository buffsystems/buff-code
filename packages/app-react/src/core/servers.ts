// Server connections (#584): what a server is, its key and storage scope, and the live controller
// one server gets — transport, event bus, event stream and data — owned by a registry that
// disposes it when the server leaves the list. Ported from the Solid app's registry.tsx and
// runtime.tsx/client.tsx without the Solid owner tree.

import { createApiForServer } from "@opencode/app/react-reuse/server-api"
import { createRequestQueue } from "@opencode/app/react-reuse/request-queue"
import type { OpenCodeClient } from "@opencode/client/promise"
import { createConnection, type ConnectionState } from "./connection"
import { createData, type Data } from "./data/data"
import { createEventSource, type EventSource } from "./events"
import type { Store } from "./store"

export type ServerHttp = { url: string; password?: string }
type Named = { displayName?: string; label?: string }

export type ServerConnection =
  | ({ type: "http"; http: ServerHttp; authToken?: boolean } & Named)
  | ({
      type: "sidecar"
      variant: "base"
      http: ServerHttp
      reconnect?: (signal: AbortSignal) => Promise<ServerHttp>
    } & Named)
  | ({ type: "sidecar"; variant: "wsl"; distro: string; http: ServerHttp } & Named)
  | ({
      type: "ssh"
      host: string
      id?: string
      http: ServerHttp
      reconnect?: (signal: AbortSignal) => Promise<ServerHttp>
    } & Named)

export function serverKey(conn: ServerConnection) {
  if (conn.type === "http") return conn.http.url
  if (conn.type === "ssh") return `ssh:${conn.id ?? conn.host}`
  return conn.variant === "wsl" ? `wsl:${conn.distro}` : "sidecar"
}

/** The bundled sidecar or a server on this machine's loopback, as the Solid ServerConnection.local. */
export function isLocalServer(conn: ServerConnection) {
  if (conn.type === "sidecar") return conn.variant === "base"
  if (conn.type !== "http") return false
  const host = conn.http.url.replace(/^https?:\/\//, "").split(":")[0]
  return host === "localhost" || host === "127.0.0.1"
}

/** Persistence scope of a server: the bundled sidecar and the page's own server share "local". */
export function serverScope(key: string, canonicalLocalServer?: string) {
  return key === "sidecar" || key === canonicalLocalServer ? "local" : key
}

export function serverName(conn: ServerConnection) {
  if (conn.displayName) return conn.displayName
  if (conn.type === "ssh") return conn.host
  return conn.http.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

/** Servers the host provides, overlaid by the stored ones with the same key. */
export function resolveServerList(input: {
  provided?: ServerConnection[]
  stored: Extract<ServerConnection, { type: "http" }>[]
}) {
  const servers = new Map(input.provided?.map((conn) => [serverKey(conn), conn]))
  input.stored.forEach((conn) => {
    const existing = servers.get(serverKey(conn))
    servers.set(
      serverKey(conn),
      existing ? ({ ...existing, ...conn, http: { ...existing.http, ...conn.http } } as ServerConnection) : conn,
    )
  })
  return [...servers.values()]
}

export type ServerOptions = {
  fetch?: typeof globalThis.fetch
  initialMessageLimit?: () => number
  onError?: (error: unknown) => void
  /** Reconnect on page show/online and drop half-open streams after sleep (the browser window). */
  pageLifecycle?: boolean
}

/** The live side of one server. */
export type Server = {
  conn: ServerConnection
  key: string
  api: () => OpenCodeClient
  event: EventSource
  connection: Store<ConnectionState>
  data: Data
  resync: (reason: string) => void
  dispose: () => void
}

export function createServer(conn: ServerConnection, options: ServerOptions = {}): Server {
  const queue = createRequestQueue({ fetch: options.fetch ?? globalThis.fetch })
  const build = (http: ServerHttp): OpenCodeClient => createApiForServer({ server: http, fetch: queue.fetch })
  const live = { api: build(conn.http) }
  const reconnect = "reconnect" in conn ? conn.reconnect : undefined
  const events = createEventSource()
  const connection = createConnection(live.api, {
    reconnect: reconnect
      ? async (signal) => {
          live.api = build(await reconnect(signal))
          return live.api
        }
      : undefined,
    flushInterval: 16,
    pageLifecycle: options.pageLifecycle ?? true,
    onEvent: events.publish,
  })
  const data = createData({
    api: () => live.api,
    directory: "",
    event: events.event,
    connection: connection.state,
    initialMessageLimit: options.initialMessageLimit,
    onError: options.onError,
  })
  return {
    conn,
    key: serverKey(conn),
    api: () => live.api,
    event: events.event,
    connection: connection.state,
    data,
    resync: connection.resync,
    dispose() {
      data.dispose()
      connection.dispose()
      events.clear()
    },
  }
}

/** One controller per server key, created on first use and disposed when the server is removed. */
export function createServerRegistry(options: ServerOptions = {}) {
  const servers = new Map<string, Server>()
  return {
    ensure(conn: ServerConnection) {
      const existing = servers.get(serverKey(conn))
      if (existing) return existing
      const server = createServer(conn, options)
      servers.set(server.key, server)
      return server
    },
    get: (key: string) => servers.get(key),
    /** Dispose the controllers of servers no longer in `list`. */
    retain(list: ServerConnection[]) {
      const keep = new Set(list.map(serverKey))
      servers.forEach((server, key) => {
        if (keep.has(key)) return
        server.dispose()
        servers.delete(key)
      })
    },
    dispose() {
      servers.forEach((server) => server.dispose())
      servers.clear()
    },
  }
}

export type ServerRegistry = ReturnType<typeof createServerRegistry>
