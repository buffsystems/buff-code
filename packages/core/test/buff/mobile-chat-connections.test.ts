// Web client (#969, R13-07): a connection can be turned off for one chat and back on.
import { describe, expect, test } from "bun:test"
import { RefusalError, type DeviceRecord } from "@buff/mobile-protocol"
import { mobileApi, type Call } from "../../src/buff/mobile/api"

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

describe("a connection turned off for one chat (R13-07)", () => {
  test("the chat's connection list says which are on here; one is turned off and back on", async () => {
    const { api } = machine()
    expect((await api.run(record, "mcp.list", { session: "ses_main" })).servers).toEqual([
      { name: "mail", ok: true, on: true },
      { name: "docs", ok: true, on: true },
    ])
    expect(await api.run(record, "session.connection", { session: "ses_main", server: "mail", on: false })).toEqual({
      ok: true,
      off: ["mail"],
    })
    expect((await api.run(record, "mcp.list", { session: "ses_main" })).servers).toEqual([
      { name: "mail", ok: true, on: false },
      { name: "docs", ok: true, on: true },
    ])
    expect(await api.run(record, "session.connection", { session: "ses_main", server: "mail", on: true })).toEqual({
      ok: true,
      off: [],
    })
  })

  test("on or off is required", async () => {
    const { api } = machine()
    await expect(api.run(record, "session.connection", { session: "ses_main", server: "mail" })).rejects.toBeInstanceOf(
      RefusalError,
    )
  })
})
