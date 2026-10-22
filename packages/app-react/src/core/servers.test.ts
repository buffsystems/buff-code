import { afterEach, expect, test } from "bun:test"
import {
  createServer,
  createServerRegistry,
  isLocalServer,
  resolveServerList,
  serverKey,
  serverScope,
  type Server,
} from "./servers"

const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 300 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 5))
  expect(check()).toBe(true)
}

// A local server: an event stream that opens with server.connected, and JSON for the reads it triggers.
function localServer(routes: Record<string, unknown>) {
  const requests: string[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    requests.push(path)
    if (path === "/api/event") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const frame = { id: "evt_1", type: "server.connected", created: 0, data: {} }
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
          request.signal.addEventListener("abort", () => controller.close(), { once: true })
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }
    if (!(path in routes)) return new Response("not found", { status: 404 })
    return Response.json(routes[path])
  }
  return { fetch: Object.assign(fetch, { preconnect: () => undefined }), requests }
}

let server: Server | undefined
afterEach(() => server?.dispose())

test("a server connects its event stream and hydrates its data through the real client", async () => {
  const local = localServer({
    "/api/session/active": {},
    "/api/location": { directory: "/repo", project: { id: "prj_1" } },
    "/api/vcs": { location: { directory: "/repo" }, data: {} },
    "/api/project": [{ id: "prj_1", canonical: "/repo", sandboxes: [], time: { created: 1, updated: 1 } }],
  })
  server = createServer(
    { type: "http", http: { url: "http://127.0.0.1:4096" } },
    { fetch: local.fetch, pageLifecycle: false },
  )
  await until(() => server?.connection.get().status === "connected")
  await until(() => (server?.data.project.list().length ?? 0) > 0)
  expect(server.data.project.list()[0]?.canonical).toBe("/repo")
  expect(local.requests).toContain("/api/event")
})

test("keys, scopes and the provided-plus-stored server list follow the Solid registry", () => {
  expect(serverKey({ type: "http", http: { url: "http://a" } })).toBe("http://a")
  expect(serverKey({ type: "sidecar", variant: "base", http: { url: "http://b" } })).toBe("sidecar")
  expect(serverKey({ type: "ssh", host: "box", http: { url: "http://c" } })).toBe("ssh:box")
  expect(serverScope("sidecar")).toBe("local")
  expect(serverScope("http://a", "http://a")).toBe("local")
  expect(serverScope("http://a")).toBe("http://a")
  const list = resolveServerList({
    provided: [{ type: "http", http: { url: "http://a" }, displayName: "A" }],
    stored: [
      { type: "http", http: { url: "http://a", password: "p" } },
      { type: "http", http: { url: "http://z" } },
    ],
  })
  expect(list).toEqual([
    { type: "http", http: { url: "http://a", password: "p" }, displayName: "A" },
    { type: "http", http: { url: "http://z" } },
  ])
})

test("the registry keeps one controller per server and disposes removed ones", () => {
  const local = localServer({})
  const registry = createServerRegistry({ fetch: local.fetch, pageLifecycle: false })
  const a = { type: "http" as const, http: { url: "http://a" } }
  const first = registry.ensure(a)
  expect(registry.ensure(a)).toBe(first)
  registry.retain([])
  expect(registry.get("http://a")).toBeUndefined()
  registry.dispose()
})

test("a server is local when it is the bundled sidecar or on the loopback by name", () => {
  const http = (url: string) => ({ type: "http" as const, http: { url } })
  expect(isLocalServer(http("http://127.0.0.1:4096"))).toBe(true)
  expect(isLocalServer(http("http://localhost:4096"))).toBe(true)
  expect(isLocalServer(http("http://summary-remote.test:4096"))).toBe(false)
  expect(isLocalServer({ type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:1" } })).toBe(true)
  expect(isLocalServer({ type: "sidecar", variant: "wsl", distro: "Ubuntu", http: { url: "http://127.0.0.1:1" } })).toBe(
    false,
  )
  expect(isLocalServer({ type: "ssh", host: "box", http: { url: "http://127.0.0.1:1" } })).toBe(false)
})
