// Web client (#969): what a person does with a chat from the list — remove, move, pin, archive,
// branch, export — and the search over what was said. The fake `Call` stands for the server.
import { describe, expect, test } from "bun:test"
import type { DeviceRecord } from "@buff/mobile-protocol"
import { mobileApi, type Call } from "../../src/buff/mobile/api"

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
const SHOP = `${HOME}/projects/shop`
const machine = { home: HOME, cloud: true, limits: { uploadMaxBytes: 1000, memoryMaxChars: 500, mcpServersMax: 3 } }

function server(active: string[] = []) {
  const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; body?: unknown }> = []
  const call: Call = async (method, route, options) => {
    calls.push({ method, path: route, query: options?.query, body: options?.body })
    if (route === "/api/location") return { directory: HOME, project: { id: "home", directory: HOME, canonical: HOME } }
    if (route === "/api/project")
      return [
        { id: "home", canonical: HOME, time: { updated: 2 } },
        { id: "p1", canonical: SHOP, name: "Shop", time: { updated: 3 } },
      ]
    if (route === "/api/session/active") return { data: Object.fromEntries(active.map((id) => [id, {}])) }
    if (route === "/api/session/s1") return { data: { id: "s1", title: "Menu", projectID: "p1", location: { directory: SHOP } } }
    if (route === "/api/session/s1/fork") return { data: { id: "s9", title: "Menu" } }
    if (route === "/api/experimental/session/s1/export")
      return {
        data: {
          info: { title: "Menu", time: { created: 5 }, model: { id: "kimi", providerID: "own" } },
          messages: [
            { type: "user", text: "hello", time: { created: 6 } },
            { type: "assistant", content: [{ type: "text", text: "hi" }], time: { created: 7 } },
          ],
        },
      }
    if (route === "/api/rpc/buff.search/sessions")
      return {
        output: [
          {
            sessionID: "s1",
            title: "Menu",
            directory: SHOP,
            messageID: "m1",
            role: "user",
            time: 6,
            fragment: { before: "", match: "hello", after: "" },
            more: 2,
          },
          {
            sessionID: "s2",
            directory: HOME,
            messageID: "m2",
            role: "assistant",
            time: 5,
            fragment: { before: "say ", match: "hello", after: "" },
            more: 0,
          },
        ],
      }
    return { data: {} }
  }
  return { calls, call }
}
const last = (calls: ReturnType<typeof server>["calls"], route: string) => calls.findLast((c) => c.path === route)

describe("chat operations", () => {
  test("remove deletes the chat on the machine", async () => {
    const { calls, call } = server()
    expect(await mobileApi(call, undefined, { machine }).run(record, "session.remove", { session: "s1" })).toEqual({ ok: true })
    expect(last(calls, "/api/session/s1")?.method).toBe("DELETE")
  })

  test("move goes to the project's folder, or home when the project is null", async () => {
    const { calls, call } = server()
    const api = mobileApi(call, undefined, { machine })
    await api.run(record, "session.move", { session: "s1", project: "p1" })
    expect(last(calls, "/api/session/s1/move")?.body).toEqual({ directory: SHOP })
    await api.run(record, "session.move", { session: "s1", project: null })
    expect(last(calls, "/api/session/s1/move")?.body).toEqual({ directory: HOME })
    await expect(api.run(record, "session.move", { session: "s1", project: "nope", lang: "en" })).rejects.toThrow(
      "No such project on this machine",
    )
    await expect(api.run(record, "session.move", { session: "s1", lang: "en" })).rejects.toThrow("The field project is required")
  })

  test("a running chat is not moved", async () => {
    const { calls, call } = server(["s1"])
    await expect(
      mobileApi(call, undefined, { machine }).run(record, "session.move", { session: "s1", project: null, lang: "en" }),
    ).rejects.toThrow("The chat is working — wait for it to finish or stop it")
    expect(last(calls, "/api/session/s1/move")).toBeUndefined()
  })

  test("pin and archive are the person's marks, the same the window keeps", async () => {
    const { calls, call } = server()
    const api = mobileApi(call, undefined, { machine })
    await api.run(record, "session.pin", { session: "s1", on: true })
    expect(last(calls, "/api/rpc/buff.session-marks/change")).toMatchObject({
      query: { "location[directory]": HOME },
      body: { input: { type: "pin", sessionID: "s1", on: true } },
    })
    await api.run(record, "session.archive", { session: "s1", on: false })
    expect(last(calls, "/api/rpc/buff.session-marks/change")?.body).toEqual({
      input: { type: "archive", sessionID: "s1", on: false },
    })
  })

  test("a branch copies the history before a message and is titled after its chat, in the person's language", async () => {
    const { calls, call } = server()
    const api = mobileApi(call, undefined, { machine })
    expect(await api.run(record, "session.fork", { session: "s1", before: "m3", lang: "ru" })).toEqual({
      ok: true,
      session: { id: "s9" },
    })
    expect(last(calls, "/api/session/s1/fork")?.body).toEqual({ before: "m3" })
    expect(last(calls, "/api/session/s9")).toMatchObject({ method: "PATCH", body: { title: "Ветка: Menu" } })
    await api.run(record, "session.fork", { session: "s1", lang: "en" })
    expect(last(calls, "/api/session/s1/fork")?.body).toEqual({})
    expect(last(calls, "/api/session/s9")?.body).toEqual({ title: "Branch: Menu" })
  })

  test("export hands the chat over as a file's text; no model or provider in it", async () => {
    const api = mobileApi(server().call, undefined, { machine })
    expect(await api.run(record, "session.export", { session: "s1", format: "md", lang: "en" })).toEqual({
      ok: true,
      name: "Menu.md",
      mime: "text/markdown",
      text: "# Menu\n\n## You\n\nhello\n\n## Buff Code\n\nhi\n",
    })
    const json = (await api.run(record, "session.export", { session: "s1", format: "json" })) as unknown as {
      name: string
      mime: string
      text: string
    }
    expect(json.name).toBe("Menu.json")
    expect(json.mime).toBe("application/json")
    expect(JSON.parse(json.text).messages).toHaveLength(2)
    expect(json.text).not.toMatch(/kimi|own/)
    await expect(api.run(record, "session.export", { session: "s1", format: "pdf", lang: "en" })).rejects.toThrow(
      "The format is md or json",
    )
  })
})

describe("an undone turn", () => {
  test("the chat's state names the message the chat is taken back to — what follows it goes with the next request", async () => {
    const { call } = server()
    const staged: Call = async (method, route, options) =>
      route === "/api/session/s1" && method === "GET"
        ? { data: { id: "s1", title: "Menu", projectID: "p1", location: { directory: SHOP }, revert: { messageID: "m4" } } }
        : route === "/api/session/s1/message" || route === "/api/session"
          ? { data: [] }
          : call(method, route, options)
    const state = (await mobileApi(staged, undefined, { machine }).run(record, "session.state", { session: "s1" })) as any
    expect(state.reverted).toBe("m4")
    const unstaged: Call = async (method, route, options) =>
      route === "/api/session" ? { data: [] } : call(method, route, options)
    const plain = (await mobileApi(unstaged, undefined, { machine }).run(record, "session.state", { session: "s1" })) as any
    expect("reverted" in plain).toBe(false)
  })

  test("a part still being written is shown with what is written so far", async () => {
    const { call } = server()
    const writing: Call = async (method, route, options) =>
      route === "/api/session/s1/message"
        ? { data: [{ id: "m1", type: "assistant", content: [{ type: "text", text: "" }] }] }
        : route === "/api/session"
          ? { data: [] }
          : call(method, route, options)
    const api = mobileApi(writing, undefined, {
      machine,
      writing: (messages) => messages.map((m: any) => ({ ...m, content: [{ type: "text", text: "Прив", streaming: true }] })),
    })
    const state = (await api.run(record, "session.state", { session: "s1" })) as any
    expect(state.messages[0].content).toEqual([{ type: "text", text: "Прив", streaming: true }])
  })
})

describe("search", () => {
  test("matches name their chat and its project — null outside projects", async () => {
    const { calls, call } = server()
    const api = mobileApi(call, undefined, { machine })
    expect(await api.run(record, "search", { query: "hello" })).toEqual({
      ok: true,
      results: [
        {
          session: "s1",
          title: "Menu",
          project: "p1",
          message: "m1",
          role: "user",
          time: 6,
          fragment: { before: "", match: "hello", after: "" },
          more: 2,
        },
        {
          session: "s2",
          title: "",
          project: null,
          message: "m2",
          role: "assistant",
          time: 5,
          fragment: { before: "say ", match: "hello", after: "" },
          more: 0,
        },
      ],
    })
    expect(last(calls, "/api/rpc/buff.search/sessions")?.body).toEqual({ input: { query: "hello" } })
  })

  test("a query too short to search is answered with nothing, without asking the machine", async () => {
    const { calls, call } = server()
    expect(await mobileApi(call, undefined, { machine }).run(record, "search", { query: " a " })).toEqual({
      ok: true,
      results: [],
    })
    expect(last(calls, "/api/rpc/buff.search/sessions")).toBeUndefined()
  })
})
