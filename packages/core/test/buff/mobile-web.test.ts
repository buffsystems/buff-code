// Web client (#969, R13-02): a web chat is a web chat — its connection's sign-in comes back to the
// web client, not to the phone app.
import { describe, expect, test } from "bun:test"
import type { DeviceRecord } from "@buff/mobile-protocol"
import { mobileApi, sessionOrigin, type Call } from "../../src/buff/mobile/api"

const record: DeviceRecord = {
  peer: "m",
  device: "web",
  dh: "x",
  display: "Firefox",
  pairId: "P1",
  created: 1,
  login: "owner",
  org: null,
}

function machine() {
  const sent: Array<{ method: string; path: string; body?: any }> = []
  const off: Record<string, string[]> = {}
  const call: Call = async (method, route, options) => {
    const body = options?.body as any
    sent.push({ method, path: route, body })
    if (route === "/api/project") return [{ id: "p1", canonical: "/work/shop", time: { updated: 2 } }]
    if (route === "/api/model")
      return { data: [{ id: "m", modelID: "sonnet", providerID: "anthropic", name: "Sonnet" }] }
    if (route === "/api/session" && method === "POST") return { data: { id: "s1" } }
    if (route === "/api/session/ses_helper")
      return { data: { id: "ses_helper", parentID: "ses_main", location: { directory: "/work/shop" } } }
    if (route.startsWith("/api/session/ses_main") && method === "GET" && route === "/api/session/ses_main")
      return { data: { id: "ses_main", location: { directory: "/work/shop" } } }
    if (route === "/api/mcp")
      return {
        data: [
          { name: "mail", status: { status: "connected" } },
          { name: "docs", status: { status: "connected" } },
        ],
      }
    if (route === "/api/rpc/buff.chat-connections/get") return { output: { off: off[body.input.sessionID] ?? [] } }
    if (route === "/api/rpc/buff.chat-connections/change") {
      const { sessionID, server, on } = body.input
      off[sessionID] = on ? (off[sessionID] ?? []).filter((x) => x !== server) : [...(off[sessionID] ?? []), server]
      return { output: { off: off[sessionID] } }
    }
    return { data: {} }
  }
  return { sent, api: mobileApi(call) }
}

describe("a web chat (R13-02)", () => {
  test("a chat begun on the web says so; the phone's stays the phone's", async () => {
    const { api, sent } = machine()
    await api.run(record, "session.new", { project: "p1", model: "anthropic/sonnet", origin: "web" })
    expect(sent.find((c) => c.path === "/api/session" && c.method === "POST")?.body.metadata).toEqual({
      origin: "web",
      device: "Firefox",
    })
    await api.run(record, "session.new", { project: "p1", model: "anthropic/sonnet" })
    expect(sent.findLast((c) => c.path === "/api/session" && c.method === "POST")?.body.metadata.origin).toBe("phone")
  })

  test("lists keep calling it a phone's: apps that know no «web» are not broken", () => {
    expect(sessionOrigin("web")).toBe("phone")
  })

  test("a request from the web says so in its message; the phone's carries no new mark (R14-01)", async () => {
    const { api, sent } = machine()
    await api.run(record, "session.prompt", { session: "ses_main", text: "hi", client: "web" })
    expect(sent.findLast((c) => c.path === "/api/session/ses_main/prompt")?.body.metadata).toEqual({
      source: "phone",
      client: "web",
    })
    await api.run(record, "session.prompt", { session: "ses_main", text: "hi" })
    expect(sent.findLast((c) => c.path === "/api/session/ses_main/prompt")?.body.metadata).toEqual({ source: "phone" })
    await api.run(record, "session.new", { project: "p1", model: "anthropic/sonnet", origin: "web", prompt: "go", client: "web" })
    expect(sent.findLast((c) => c.path === "/api/session/s1/prompt")?.body.metadata).toEqual({
      source: "phone",
      client: "web",
    })
  })

  test("a request names the client's time zone, when it is one Intl knows (#969 live check)", async () => {
    const { api, sent } = machine()
    await api.run(record, "session.prompt", { session: "ses_main", text: "hi", client: "web", zone: "Europe/Berlin" })
    expect(sent.findLast((c) => c.path === "/api/session/ses_main/prompt")?.body.metadata).toEqual({
      source: "phone",
      client: "web",
      zone: "Europe/Berlin",
    })
    await api.run(record, "session.prompt", { session: "ses_main", text: "hi", zone: "Mars/Olympus" })
    expect(sent.findLast((c) => c.path === "/api/session/ses_main/prompt")?.body.metadata).toEqual({ source: "phone" })
  })
})

