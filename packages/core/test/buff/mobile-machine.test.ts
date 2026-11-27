// Web client (#969): what the machine tells about itself, chats outside projects and the one chat
// list across projects. The fake `Call` stands for the Buff Code server.
import { describe, expect, test } from "bun:test"
import type { DeviceRecord } from "@buff/mobile-protocol"
import { mobileApi, type Call } from "../../src/buff/mobile/api"
import { machineOf } from "../../src/buff/mobile/api-machine"

const record: DeviceRecord = {
  peer: "m",
  device: "web",
  dh: "x",
  display: "Browser",
  pairId: "P1",
  created: 1,
  login: "owner",
  org: null,
}

const HOME = "/home/user"
const sessions = [
  { id: "s1", projectID: "home", title: "Outside", time: { created: 1, updated: 9 } },
  { id: "s2", projectID: "p1", title: "In a project", time: { created: 2, updated: 8 } },
  { id: "s3", projectID: "home", parentID: "s1", title: "A helper", time: { created: 3, updated: 7 } },
  { id: "s4", projectID: "home", title: "Old", time: { created: 4, updated: 6, archived: 5 } },
  { id: "s5", projectID: "p1", title: "Branch", fork: { sessionID: "s2" }, time: { created: 5, updated: 5 } },
  { id: "s6", projectID: "home", title: "Put away", time: { created: 6, updated: 4 } },
  { id: "s7", projectID: "home", title: "Side talk", time: { created: 7, updated: 3 } },
]

function server() {
  const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; body?: unknown }> = []
  const call: Call = async (method, route, options) => {
    calls.push({ method, path: route, query: options?.query, body: options?.body })
    if (route === "/api/location")
      return { directory: HOME, project: { id: "home", directory: HOME, canonical: HOME } }
    if (route === "/api/project")
      return [
        { id: "home", canonical: HOME, time: { updated: 2 } },
        { id: "p1", canonical: `${HOME}/projects/shop`, name: "Shop", time: { updated: 3 } },
      ]
    if (route === "/api/model")
      return { data: [{ id: "optimal", modelID: "optimal", providerID: "gw", name: "Optimal" }] }
    if (route === "/api/agent") return { data: [] }
    if (route === "/api/session" && method === "POST") return { data: { id: "new" } }
    if (route === "/api/session") {
      const wanted = options?.query?.project
      const list = sessions.filter((x) => !wanted || x.projectID === wanted)
      return options?.query?.cursor ? { data: [] } : { data: list, cursor: { next: "more" } }
    }
    if (route === "/api/session/active") return { data: { s2: {} } }
    if (route === "/api/form") return { data: [{ sessionID: "s3" }] }
    if (route === "/api/permission/request") return { data: [] }
    if (route === "/api/rpc/buff.session-marks/get")
      return { output: { pinned: ["s2"], archived: ["s6"], groups: [], membership: {}, sides: ["s7"] } }
    return { data: {} }
  }
  return { calls, call }
}

const machine = { home: HOME, cloud: true, limits: { uploadMaxBytes: 1000, memoryMaxChars: 500, mcpServersMax: 3 } }

describe("machine.info", () => {
  test("a cloud machine names its home, where projects live and the limits it was started with", async () => {
    const api = mobileApi(server().call, undefined, { machine })
    expect(await api.run(record, "machine.info", {})).toEqual({
      ok: true,
      api: 3,
      cloud: true,
      home: { project: "home", directory: HOME },
      projectsRoot: `${HOME}/projects`,
      limits: { uploadMaxBytes: 1000, memoryMaxChars: 500, mcpServersMax: 3 },
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  })

  // R15-01: the machine's clock is the person's zone (TZ); a client shows a schedule with no zone of
  // its own by it.
  test("the machine names the time zone of its clock", async () => {
    const api = mobileApi(server().call, undefined, { machine })
    expect((await api.run(record, "machine.info", {})).zone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  test("the reply names no model, provider or gateway", async () => {
    const api = mobileApi(server().call, undefined, { machine })
    expect(JSON.stringify(await api.run(record, "machine.info", {}))).not.toMatch(/model|provider|gw/i)
  })

  test("the environment decides: BUFF_CLOUD marks the cloud, BUFF_CLOUD_LIMITS carries the operator's limits", () => {
    expect(machineOf({}, HOME)).toEqual({
      home: HOME,
      cloud: false,
      limits: { uploadMaxBytes: 20 * 1024 * 1024, memoryMaxChars: 8000, mcpServersMax: 10 },
    })
    const cloud = machineOf({ BUFF_CLOUD: "1", BUFF_CLOUD_LIMITS: '{"uploadMaxBytes":5,"mcpServersMax":0}' }, HOME)
    expect(cloud.cloud).toBe(true)
    expect(cloud.limits).toEqual({ uploadMaxBytes: 5, memoryMaxChars: 8000, mcpServersMax: 0 })
    // A broken or hostile value never takes the machine down: the defaults stand.
    expect(machineOf({ BUFF_CLOUD_LIMITS: "{oops" }, HOME).limits.uploadMaxBytes).toBe(20 * 1024 * 1024)
    expect(machineOf({ BUFF_CLOUD_LIMITS: '{"uploadMaxBytes":-1,"memoryMaxChars":"9"}' }, HOME).limits).toEqual({
      uploadMaxBytes: 20 * 1024 * 1024,
      memoryMaxChars: 8000,
      mcpServersMax: 10,
    })
  })
})

describe("a chat outside projects", () => {
  test("session.new without a project starts in the machine's home", async () => {
    const { calls, call } = server()
    const api = mobileApi(call, undefined, { machine })
    expect(await api.run(record, "session.new", { model: "gw/optimal", prompt: "hi" })).toEqual({
      ok: true,
      session: { id: "new" },
    })
    const created = calls.find((c) => c.method === "POST" && c.path === "/api/session")
    expect((created?.body as { location: unknown }).location).toEqual({ directory: HOME })
  })

  test("session.new with a project still demands a known one — as old phones send it", async () => {
    const api = mobileApi(server().call, undefined, { machine })
    await expect(api.run(record, "session.new", { project: "nope", model: "gw/optimal", lang: "en" })).rejects.toThrow(
      "No such project on this machine",
    )
    expect(await api.run(record, "session.new", { project: "p1", model: "gw/optimal" })).toMatchObject({ ok: true })
  })

  test("models and agents are listed for the home when no project is named", async () => {
    const { calls, call } = server()
    const api = mobileApi(call, undefined, { machine })
    expect(await api.run(record, "models.list", {})).toMatchObject({ ok: true, default: "gw/optimal" })
    expect(calls.find((c) => c.path === "/api/model")?.query).toEqual({ "location[directory]": HOME })
  })
})

describe("chats.list", () => {
  test("all chats in one list: the project is null outside projects; helpers, archived and side talks are left out", async () => {
    const api = mobileApi(server().call, undefined, { machine })
    expect(await api.run(record, "chats.list", { limit: 50 })).toEqual({
      ok: true,
      chats: [
        { id: "s1", title: "Outside", project: null, created: 1, updated: 9, running: false, waiting: true },
        { id: "s2", title: "In a project", project: "p1", created: 2, updated: 8, running: true, pinned: true },
        { id: "s5", title: "Branch", project: "p1", created: 5, updated: 5, running: false, branchOf: "s2" },
      ],
      cursor: "more",
    })
  })

  test("project: null asks for chats outside projects only; an id — for that project's", async () => {
    const { calls, call } = server()
    const api = mobileApi(call, undefined, { machine })
    const outside = (await api.run(record, "chats.list", { project: null })) as unknown as { chats: { id: string }[] }
    expect(outside.chats.map((c) => c.id)).toEqual(["s1"])
    expect(calls.findLast((c) => c.path === "/api/session")?.query?.project).toBe("home")
    const inside = (await api.run(record, "chats.list", { project: "p1" })) as unknown as { chats: { id: string }[] }
    expect(inside.chats.map((c) => c.id)).toEqual(["s2", "s5"])
    await expect(api.run(record, "chats.list", { project: "nope", lang: "en" })).rejects.toThrow("No such project on this machine")
  })

  test("archived: true lists what was put away — by the engine's mark or the person's", async () => {
    const api = mobileApi(server().call, undefined, { machine })
    const got = (await api.run(record, "chats.list", { archived: true })) as unknown as { chats: { id: string }[] }
    expect(got.chats.map((c) => c.id)).toEqual(["s4", "s6"])
  })

  test("the next page goes by the cursor", async () => {
    const { calls, call } = server()
    const api = mobileApi(call, undefined, { machine })
    expect(await api.run(record, "chats.list", { cursor: "more", limit: 10 })).toEqual({ ok: true, chats: [] })
    expect(calls.findLast((c) => c.path === "/api/session")?.query).toMatchObject({ cursor: "more", limit: 10 })
  })
})
