// R23-01 (#969): a helper's (subagent's) ask stops its run until the person answers — so the chat
// that started it shows the ask too, marked with the helper, and the helper is marked waiting. The
// answer from the parent goes to the helper's session.
import { describe, expect, test } from "bun:test"
import type { DeviceRecord } from "@buff/mobile-protocol"
import { mobileApi, type Call } from "../../src/buff/mobile/api"

const record: DeviceRecord = { peer: "m", device: "web", dh: "x", display: "Firefox", pairId: "P1", created: 1, login: "o", org: null }
const ASK = { id: "per_1", sessionID: "ses_helper", action: "external_directory", resources: ["/etc/hosts"] }
const FORM = { id: "frm_1", sessionID: "ses_helper", title: "Какой файл?", fields: [] }

function machine() {
  const sent: Array<{ method: string; path: string }> = []
  const call: Call = async (method, route, options) => {
    sent.push({ method, path: route })
    if (route === "/api/session/active") return { data: { ses_main: {}, ses_helper: {}, ses_done: {} } }
    if (route === "/api/session/ses_main") return { data: { id: "ses_main", projectID: "p1" } }
    if (route === "/api/session" && method === "GET" && (options?.query as { parentID?: string })?.parentID === "ses_main")
      return {
        data: [
          { id: "ses_helper", title: "Разведка", agent: "explore" },
          { id: "ses_quiet", title: "Тихий" },
        ],
      }
    if (route === "/api/session/ses_helper/permission") return { data: [ASK] }
    if (route === "/api/session/ses_helper/form") return { data: [FORM] }
    if (route.endsWith("/permission") || route.endsWith("/form") || route === "/api/form") return { data: [] }
    return { data: [] }
  }
  return { sent, api: mobileApi(call) }
}

describe("a helper's ask in the chat that started it (R23-01)", () => {
  test("the parent's state carries the running helper's asks, marked with the helper; the helper waits", async () => {
    const { api } = machine()
    const state = await api.state("ses_main")
    expect(state.permissions).toEqual([{ ...ASK, helper: { id: "ses_helper", title: "Разведка" } }])
    expect(state.forms).toEqual([{ ...FORM, helper: { id: "ses_helper", title: "Разведка" } }])
    const subagents = state.subagents as Array<{ id: string; waiting?: boolean }>
    expect(subagents.find((s) => s.id === "ses_helper")?.waiting).toBe(true)
    expect(subagents.find((s) => s.id === "ses_quiet")?.waiting).toBeUndefined()
  })

  test("the answer given in the parent goes to the helper's session", async () => {
    const { api, sent } = machine()
    await api.run(record, "permission.answer", { session: "ses_main", owner: "ses_helper", request: "per_1", decision: "once" })
    expect(sent.at(-1)).toEqual({ method: "POST", path: "/api/session/ses_helper/permission/per_1/reply" })
  })
})

// R24: the engine allows a helper's own helper when `experimental.subagent_depth` is raised (the
// default 1 forbids it). A grandchild's ask stops the chain too: the top chat shows it, named by
// the helper that asks, and marks its own helper waiting.
describe("a helper's helper asking (R24)", () => {
  test("the grandchild's ask reaches the top chat; the top chat's helper is marked waiting", async () => {
    const GRAND = { id: "per_g", sessionID: "ses_grand", action: "bash", resources: ["ls"] }
    const call: Call = async (method, route, options) => {
      const parent = (options?.query as { parentID?: string } | undefined)?.parentID
      if (route === "/api/session/active") return { data: { ses_main: {}, ses_helper: {}, ses_grand: {} } }
      if (route === "/api/session/ses_main") return { data: { id: "ses_main", projectID: "p1" } }
      if (route === "/api/session" && method === "GET" && parent === "ses_main")
        return { data: [{ id: "ses_helper", title: "Разведка", parentID: "ses_main" }] }
      if (route === "/api/session" && method === "GET" && parent === "ses_helper")
        return { data: [{ id: "ses_grand", title: "Проверка", parentID: "ses_helper" }] }
      if (route === "/api/session/ses_grand/permission") return { data: [GRAND] }
      return { data: [] }
    }
    const state = await mobileApi(call).state("ses_main")
    expect(state.permissions).toEqual([{ ...GRAND, helper: { id: "ses_grand", title: "Проверка" } }])
    const subagents = state.subagents as Array<{ id: string; waiting?: boolean }>
    expect(subagents).toHaveLength(1)
    expect(subagents[0]).toMatchObject({ id: "ses_helper", waiting: true })
  })
})
