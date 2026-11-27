// Chat plugins for the phone and the web client (#595, #982): the list, a plugin's view in
// parts, the switch, and a visual's state for the model.
import { describe, expect, test } from "bun:test"
import type { DeviceRecord } from "@buff/mobile-protocol"
import { mobileApi, type Call } from "../../src/buff/mobile/api"
import { VIEW_PART } from "../../src/buff/mobile/api-plugins"

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
const PROJECT = "/home/user/shop"

const charts = {
  id: "charts",
  name: "Charts",
  description: "Draws charts",
  blocks: ["chart"],
  origin: "builtin",
  version: "v1",
  enabled: true,
  text: true,
  examples: ["sales"],
}

function server(html = "<div>view</div>") {
  const calls: Array<{ path: string; directory?: string; input?: any }> = []
  const replies: Record<string, unknown> = {}
  const call: Call = async (_method, route, o) => {
    const input = (o?.body as { input?: any } | undefined)?.input
    const directory = (o?.query as Record<string, string> | undefined)?.["location[directory]"]
    if (route.startsWith("/api/rpc/")) calls.push({ path: route, directory, input })
    if (route === "/api/location") return { directory: HOME, project: { id: "home", directory: HOME, canonical: HOME } }
    if (route === "/api/session/ses_1") return { data: { id: "ses_1", location: { directory: PROJECT } } }
    if (route in replies) return replies[route]
    if (route === "/api/rpc/buff.chat-plugin/list")
      return { output: { plugins: [charts, { ...charts, id: "broken", blocks: ["x"], problem: "no view" }] } }
    if (route === "/api/rpc/buff.chat-plugin/view") return { output: { html, version: "v1" } }
    if (route === "/api/rpc/buff.chat-plugin/example") return { output: { block: "chart", text: '{"a":1}' } }
    return { output: null }
  }
  const api = mobileApi(call, undefined, {
    machine: { home: HOME, cloud: false, limits: { uploadMaxBytes: 1, memoryMaxChars: 1, mcpServersMax: 1 } },
  })
  const run = (op: string, args: Record<string, unknown> = {}) =>
    api.run(record, op, { lang: "en", ...args }) as Promise<Record<string, any>>
  const reply = (route: string, answer: unknown) => void (replies[route] = answer)
  return { calls, run, reply, last: (m: string) => calls.findLast((c) => c.path.endsWith(`/${m}`)) }
}

describe("a chat's state", () => {
  // The phone and the web client read a chat in snapshots; a plugin test that waits for the app
  // comes with the state of the working chat, from the chat's own directory.
  test("carries the plugin tests a running call is waiting for", async () => {
    const tests = [{ call: "c1", id: "steps", version: "v1", name: "Steps", examples: [{ name: "morning", block: "steps" }] }]
    const s = server()
    s.reply("/api/session/active", { data: { ses_1: {} } })
    s.reply("/api/rpc/buff.chat-plugin/tests", { output: { tests } })
    const state = await s.run("session.state", { session: "ses_1" })
    expect(state.pluginTests).toEqual(tests)
    expect(s.last("tests")).toMatchObject({ directory: PROJECT, input: { session: "ses_1" } })
  })
  test("a chat that is not working asks nothing and carries none", async () => {
    const s = server()
    const state = await s.run("session.state", { session: "ses_1" })
    expect(state.pluginTests).toBeUndefined()
    expect(s.last("tests")).toBeUndefined()
  })
})

describe("plugins.list", () => {
  test("the plugins of the chat's project, as the engine lists them", async () => {
    const s = server()
    const got = await s.run("plugins.list", { session: "ses_1" })
    expect(got.plugins.map((plugin: { id: string }) => plugin.id)).toEqual(["charts", "broken"])
    expect(got.plugins[0]).toEqual(charts)
    expect(got.plugins[1].problem).toBe("no view")
    expect(s.last("list")?.directory).toBe(PROJECT)
  })
  test("a plugin's own labels name it in the client's language; the labels stay on the machine", async () => {
    const labelled = { ...charts, labels: { ru: { name: "Графики", summary: "Графики по числам" } } }
    const s = server()
    const call = s.reply("/api/rpc/buff.chat-plugin/list", { output: { plugins: [labelled] } })
    const ru = await s.run("plugins.list", { lang: "ru" })
    expect(ru.plugins[0]).toEqual({ ...charts, name: "Графики", description: "Графики по числам" })
    const en = await s.run("plugins.list", { lang: "en" })
    expect(en.plugins[0]).toEqual(charts)
    expect(call).toBeUndefined()
  })
  test("without a chat — the plugins of the machine's home", async () => {
    const s = server()
    await s.run("plugins.list")
    expect(s.last("list")?.directory).toBe(HOME)
  })
})

describe("plugins.read", () => {
  test("a small view comes whole, with its version", async () => {
    const got = await server().run("plugins.read", { id: "charts" })
    expect(got).toEqual({ ok: true, id: "charts", version: "v1", from: 0, text: "<div>view</div>" })
  })
  test("a large view comes in parts that join back into it, never splitting a character", async () => {
    const html = "я😀".repeat(VIEW_PART) // every second unit pair is a surrogate pair
    const s = server(html)
    let from = 0
    let joined = ""
    for (let guard = 0; guard < 20; guard++) {
      const part = await s.run("plugins.read", { id: "charts", session: "ses_1", from })
      expect(part.text.length).toBeLessThanOrEqual(VIEW_PART)
      expect(part.text.length).toBeGreaterThan(0)
      expect(/[\uD800-\uDBFF]$/.test(part.text)).toBe(false)
      joined += part.text
      if (part.next === undefined) break
      from = part.next
    }
    expect(joined).toBe(html)
  })
  test("a part past the end, or a negative one, is refused", async () => {
    const s = server()
    await expect(s.run("plugins.read", { id: "charts", from: 999 })).rejects.toThrow()
    await expect(s.run("plugins.read", { id: "charts", from: -1 })).rejects.toThrow()
  })
})

describe("plugins.enable, plugins.example, plugins.context", () => {
  test("the switch goes to the engine", async () => {
    const s = server()
    await s.run("plugins.enable", { id: "charts", enabled: false })
    expect(s.last("enable")?.input).toEqual({ id: "charts", enabled: false })
    await expect(s.run("plugins.enable", { id: "charts" })).rejects.toThrow()
  })
  test("an example of a block", async () => {
    expect(await server().run("plugins.example", { id: "charts", name: "sales" })).toEqual({
      ok: true,
      block: "chart",
      text: '{"a":1}',
    })
  })
  test("a visual's state is told to the engine in the chat's directory; no text clears it", async () => {
    const s = server()
    await s.run("plugins.context", { session: "ses_1", frame: "msg_1:0", id: "charts", text: "Year: 2025" })
    expect(s.last("context")).toMatchObject({
      directory: PROJECT,
      input: { session: "ses_1", frame: "msg_1:0", id: "charts", text: "Year: 2025" },
    })
    await s.run("plugins.context", { session: "ses_1", frame: "msg_1:0", id: "charts" })
    expect(s.last("context")?.input).toEqual({ session: "ses_1", frame: "msg_1:0", id: "charts" })
  })
  test("what the app drew in a live test goes to the engine; an error is cut to a line the model can read", async () => {
    const s = server()
    await s.run("plugins.report", { session: "ses_1", call: "call_9", example: "week", ok: true, height: 180 })
    expect(s.last("report")).toMatchObject({
      directory: PROJECT,
      input: { session: "ses_1", call: "call_9", example: "week", ok: true, height: 180 },
    })
    await s.run("plugins.report", {
      session: "ses_1",
      call: "call_9",
      example: "week",
      ok: false,
      error: "x".repeat(5000),
    })
    expect(s.last("report")?.input.error).toHaveLength(2000)
    await expect(s.run("plugins.report", { session: "ses_1", call: "c", example: "e" })).rejects.toThrow()
  })
})
