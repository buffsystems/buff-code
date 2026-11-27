// Web client (#969): a person's own connections (MCP servers) — remote ones only, written to the
// user's config; the engine connects them and allows their tools at once (no restart).
import { describe, expect, test } from "bun:test"
import type { DeviceRecord } from "@buff/mobile-protocol"
import { mobileApi, type Call } from "../../src/buff/mobile/api"
import { reservedName } from "../../src/buff/mobile/api-mcp"

const record: DeviceRecord = { peer: "m", device: "web", dh: "x", display: "Browser", pairId: "P1", created: 1, login: "owner", org: null }
const HOME = "/home/user"

function server(max = 3) {
  const entries: Array<Record<string, any>> = [
    { name: "buff", scope: "builtin", status: { status: "connected" } },
    { name: "draw", scope: "user", config: { type: "remote", url: "http://10.9.0.2:4100/key/mcp/draw" }, status: { status: "connected" } },
    {
      name: "github",
      scope: "user",
      config: { type: "remote", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer secret" } },
      status: { status: "connected" },
    },
    { name: "notion", scope: "user", config: { type: "remote", url: "https://mcp.notion.com/mcp" }, status: { status: "disabled" } },
    { name: "local-tool", scope: "user", config: { type: "local", command: ["npx", "x"] }, status: { status: "failed", error: "boom" } },
    { name: "repo-thing", scope: "project", config: { type: "remote", url: "https://x.example/mcp" }, status: { status: "connected" } },
  ]
  const calls: Array<{ path: string; input?: any }> = []
  const call: Call = async (_method, route, o) => {
    const input = (o?.body as { input?: any } | undefined)?.input
    if (route.startsWith("/api/rpc/")) calls.push({ path: route, input })
    if (route === "/api/location") return { directory: HOME, project: { id: "home", directory: HOME, canonical: HOME } }
    if (route === "/api/rpc/buff.mcp/list") return { output: entries }
    return { output: null }
  }
  const api = mobileApi(call, undefined, { machine: { home: HOME, cloud: true, limits: { uploadMaxBytes: 1, memoryMaxChars: 1, mcpServersMax: max } } })
  const run = (op: string, args: Record<string, unknown> = {}) => api.run(record, op, { lang: "en", ...args }) as Promise<Record<string, any>>
  return { calls, run, last: (m: string) => calls.findLast((c) => c.path.endsWith(`/${m}`))?.input }
}

describe("mcp.servers", () => {
  test("the person's servers and the service's own; header values never leave the machine", async () => {
    const s = server()
    const got = await s.run("mcp.servers")
    expect(got.max).toBe(3)
    expect(got.servers).toEqual([
      { name: "buff", scope: "builtin", type: "remote", enabled: true, status: "connected", managed: true },
      { name: "draw", scope: "builtin", type: "remote", enabled: true, status: "connected", managed: true },
      { name: "github", scope: "user", type: "remote", url: "https://api.example.com/mcp", enabled: true, status: "connected", managed: false, hasHeaders: true },
      { name: "notion", scope: "user", type: "remote", url: "https://mcp.notion.com/mcp", enabled: false, status: "disabled", managed: false },
      { name: "local-tool", scope: "user", type: "local", enabled: true, status: "failed", managed: false },
    ])
    expect(JSON.stringify(got)).not.toMatch(/secret|Bearer|10\.9\.0\.2/)
  })
})

// R15-02: the machine opens only the first N of the person's servers by name, whatever wrote the
// config — the screen marks the rest as over the limit.
describe("servers over the operator's limit", () => {
  test("are marked, by name, beyond the first N of the person's own", async () => {
    const got = await server(2).run("mcp.servers")
    expect(got.servers.filter((item: { over?: boolean }) => item.over).map((item: { name: string }) => item.name)).toEqual(["notion"])
    const roomy = await server(5).run("mcp.servers")
    expect(roomy.servers.some((item: { over?: boolean }) => item.over)).toBe(false)
  })
})

describe("mcp.save", () => {
  test("a remote server goes into the user's config; the machine connects it without a restart", async () => {
    const s = server(5)
    expect(await s.run("mcp.save", { name: "linear", url: " https://mcp.linear.app/mcp ", headers: { "X-Key": "k" } })).toEqual({
      ok: true,
      restart: false,
    })
    expect(s.last("save")).toEqual({
      scope: "user",
      name: "linear",
      config: { type: "remote", url: "https://mcp.linear.app/mcp", headers: { "X-Key": "k" } },
    })
  })

  test("an edit keeps the headers the client never saw, unless it sends new ones; a rename names the previous", async () => {
    const s = server()
    await s.run("mcp.save", { name: "gh", previous: "github", url: "https://api.example.com/v2" })
    expect(s.last("save")).toEqual({
      scope: "user",
      name: "gh",
      config: { type: "remote", url: "https://api.example.com/v2", headers: { Authorization: "Bearer secret" } },
      previous: { scope: "user", name: "github" },
    })
    await s.run("mcp.save", { name: "github", url: "https://api.example.com/v2", headers: {} })
    expect(s.last("save").config).toEqual({ type: "remote", url: "https://api.example.com/v2" })
  })

  test("refused: a reserved or malformed name, an address that is not http(s), one server too many", async () => {
    const s = server(3)
    const refused = (args: Record<string, unknown>, words: string) => expect(s.run("mcp.save", args)).rejects.toThrow(words)
    await refused({ name: "draw", url: "https://x.example/mcp" }, "The name «draw» is taken by the service — choose another.")
    await refused({ name: "external", url: "https://x.example/mcp" }, "The name «external» is taken by the service")
    await refused({ name: "buff", url: "https://x.example/mcp" }, "taken by a built-in Buff server")
    await refused({ name: "my server", url: "https://x.example/mcp" }, "The name is Latin letters")
    await refused({ name: "ok", url: "file:///etc/passwd" }, "The address starts with https:// or http://")
    await refused({ name: "ok", url: "https://x.example/mcp" }, "No more connections can be added: the limit is 3")
    expect(s.calls.some((c) => c.path.endsWith("/save"))).toBe(false)
    // An edit of an existing one is not «one more».
    await s.run("mcp.save", { name: "notion", url: "https://mcp.notion.com/v2" })
    expect(s.last("save").name).toBe("notion")
  })

  test("names the machine's rules already cover are reserved — a server could otherwise unlock them", () => {
    for (const name of ["draw", "session", "workflow", "external", "send", "todo", "plan", "memory", "shell", "question"])
      expect(reservedName(name)).toBe(true)
    for (const name of ["github", "linear", "my-notes", "sender"]) expect(reservedName(name)).toBe(false)
  })
})

describe("mcp.remove and mcp.enable", () => {
  test("act on the person's own servers only", async () => {
    const s = server()
    expect(await s.run("mcp.enable", { name: "notion", enabled: true })).toEqual({ ok: true, restart: false })
    expect(s.last("enable")).toEqual({ scope: "user", name: "notion", enabled: true })
    expect(await s.run("mcp.remove", { name: "github" })).toEqual({ ok: true, restart: false })
    expect(s.last("remove")).toEqual({ scope: "user", name: "github" })
    for (const name of ["draw", "buff"])
      await expect(s.run("mcp.remove", { name })).rejects.toThrow("This connection is managed by the service")
    await expect(s.run("mcp.enable", { name: "nope", enabled: false })).rejects.toThrow("No such connection")
  })
})
