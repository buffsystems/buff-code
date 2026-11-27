// Web client (#969, R13-04): a helper's (subagent's) chat is read-only from the API too — nothing
// that would change the helper's session behind the main agent's back.
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

describe("a helper's chat is read-only (R13-04)", () => {
  const changing: Array<[string, Record<string, unknown>]> = [
    ["session.prompt", { text: "hi" }],
    ["session.retry", { message: "m1" }],
    ["session.undo", { message: "m1" }],
    ["session.redo", {}],
    ["session.fork", {}],
    ["session.compact", {}],
    ["session.rename", { title: "x" }],
    ["session.mode", { mode: "full" }],
    ["session.agent", { agent: "build" }],
    ["session.model", { model: "anthropic/sonnet" }],
    ["session.context", { context: 0 }],
    ["commands.run", { name: "init" }],
    ["session.connection", { server: "mail", on: false }],
    // R14-07: a helper is part of its chat — it is not moved, archived, pinned or removed on its own.
    ["session.move", { project: null }],
    ["session.archive", { on: true }],
    ["session.pin", { on: true }],
    ["session.remove", {}],
  ]
  for (const [op, args] of changing)
    test(`${op} on a helper's session is refused and changes nothing`, async () => {
      const { api, sent } = machine()
      await expect(api.run(record, op, { session: "ses_helper", lang: "en", ...args })).rejects.toBeInstanceOf(
        RefusalError,
      )
      expect(sent.filter((c) => c.method !== "GET")).toEqual([])
    })

  test("the refusal says why, in the client's language", async () => {
    const { api } = machine()
    await expect(api.run(record, "session.undo", { session: "ses_helper", message: "m1", lang: "en" })).rejects.toThrow(
      /helper/i,
    )
  })

  test("the main chat is not held", async () => {
    const { api, sent } = machine()
    await api.run(record, "session.undo", { session: "ses_main", message: "m1" })
    expect(sent.at(-1)).toMatchObject({ method: "POST", path: "/api/session/ses_main/revert/stage" })
  })
})

// R14-07: the helper's own question, form or permission request is answered by the person — the
// helper's run waits for it, and refusing would leave it stuck. Answering changes nothing else.
describe("a helper waiting for the person (R14-07)", () => {
  test("its question, form and permission request can be answered", async () => {
    const { api, sent } = machine()
    await api.run(record, "question.answer", { session: "ses_helper", form: "f1", answer: { a: "yes" } })
    await api.run(record, "question.cancel", { session: "ses_helper", form: "f2" })
    await api.run(record, "permission.answer", { session: "ses_helper", request: "r1", decision: "once" })
    expect(sent.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/session/ses_helper/form/f1/reply",
      "DELETE /api/session/ses_helper/form/f2",
      "POST /api/session/ses_helper/permission/r1/reply",
    ])
  })
})

