import { afterEach, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import type { ConnectionState } from "../connection"
import { createEventSource } from "../events"
import { createStore } from "../store"
import { createData, type Data } from "./data"
import { fakeApi } from "./fake-api"
import { event, session } from "./fixtures"

const project = { id: "prj_1", canonical: "/repo", sandboxes: [], time: { created: 1, updated: 2 } }
const location = { directory: "/repo", project: { id: "prj_1" } }
const user = (id: string, created: number): SessionMessageInfo => ({ id, type: "user", text: id, time: { created } })
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

let data: Data | undefined
afterEach(() => data?.dispose())

function setup(routes: Parameters<typeof fakeApi>[0]) {
  const server = fakeApi(routes)
  const source = createEventSource()
  const connection = createStore<ConnectionState>({ status: "connected", attempt: 0 })
  data = createData({ api: () => server.api, directory: "", event: source.event, connection })
  return { server, source, connection, data }
}

test("server.connected hydrates running sessions, the default location, vcs and projects", async () => {
  const { server, source, data } = setup({
    "session.active": () => ({ ses_1: {} }),
    "location.get": () => location,
    "vcs.get": () => ({ location: { directory: "/repo" }, data: { branch: { current: "main" } } }),
    "project.list": () => [project],
  })
  source.publish(event("server.connected", {}))
  await tick()
  expect(data.session.status("ses_1")).toBe("running")
  expect(data.project.list().map((item) => item.id)).toEqual(["prj_1"])
  expect(data.state.get().location['["/repo",null]']?.vcs).toEqual({ branch: { current: "main" } })
  expect(server.called("location.get")).toHaveLength(1)
})

test("a lifecycle event during the running-session read wins over the snapshot", async () => {
  const active = Promise.withResolvers<Record<string, unknown>>()
  const { source, data } = setup({
    "session.active": () => active.promise,
    "location.get": () => location,
    "vcs.get": () => ({ location: { directory: "/repo" }, data: {} }),
    "project.list": () => [],
  })
  source.publish(event("server.connected", {}))
  source.publish(event("session.execution.succeeded", { sessionID: "ses_1" }))
  active.resolve({ ses_1: {} })
  await tick()
  await tick()
  expect(data.session.status("ses_1")).toBe("idle")
})

test("session sync loads info and children into one family", async () => {
  const { data } = setup({
    "session.get": () => session("ses_root"),
    "session.list": () => ({ data: [session("ses_child", { parentID: "ses_root" })], cursor: {} }),
  })
  await data.session.sync("ses_root", { children: true })
  expect(data.session.family("ses_child")).toEqual(["ses_root", "ses_child"])
  expect(data.session.root("ses_child")).toBe("ses_root")
})

test("a transcript loads newest-first pages and prepends older ones", async () => {
  const { server, data } = setup({
    "message.list": (input: { cursor?: string }) =>
      input.cursor
        ? { data: [user("msg_2", 2), user("msg_1", 1)], cursor: {} }
        : { data: [user("msg_4", 4), user("msg_3", 3)], cursor: { next: "c1" } },
  })
  await data.session.message.sync("ses_1")
  expect(data.session.message.list("ses_1").map((item) => item.id)).toEqual(["msg_3", "msg_4"])
  expect(data.session.message.more("ses_1")).toBe(true)
  await data.session.message.loadMore("ses_1")
  expect(data.session.message.list("ses_1").map((item) => item.id)).toEqual(["msg_1", "msg_2", "msg_3", "msg_4"])
  expect(data.session.message.more("ses_1")).toBe(false)
  await data.session.message.sync("ses_1")
  expect(server.called("message.list")).toHaveLength(2)
})

test("a created session is read once and its empty transcript is not fetched", async () => {
  const { server, source, data } = setup({ "session.get": () => session("ses_new") })
  source.publish(
    event("session.created", {
      sessionID: "ses_new",
      projectID: "prj_1",
      location: { directory: "/repo" },
      slug: "new",
      version: "1",
    }),
  )
  await tick()
  await data.session.message.sync("ses_new")
  expect(data.session.get("ses_new")?.id).toBe("ses_new")
  expect(server.called("message.list")).toHaveLength(0)
})

test("a rename applies the live title after the session read", async () => {
  const { source, data } = setup({ "session.get": () => session("ses_1", { title: "old" }) })
  source.publish(event("session.renamed", { sessionID: "ses_1", title: "new" }))
  await tick()
  await tick()
  expect(data.session.get("ses_1")?.title).toBe("new")
})

test("losing the connection makes cached reads stale", async () => {
  const { server, connection, data } = setup({ "project.list": () => [project] })
  await data.project.sync()
  await data.project.sync()
  connection.set(() => ({ status: "reconnecting", attempt: 1 }))
  connection.set(() => ({ status: "connected", attempt: 0 }))
  await data.project.sync()
  expect(server.called("project.list")).toHaveLength(2)
})

test("a pending read keeps inbox events that overtook it", async () => {
  const inbox = Promise.withResolvers<unknown[]>()
  const { source, data } = setup({ "session.inbox.list": () => inbox.promise })
  const read = data.session.pending.sync("ses_1")
  source.publish(event("session.inbox.delivered", { sessionID: "ses_1", inboxID: "msg_old" }))
  inbox.resolve([
    {
      id: "msg_old",
      sessionID: "ses_1",
      type: "user",
      delivery: "queue",
      payload: { text: "a" },
      time: { created: 1 },
    },
    {
      id: "msg_new",
      sessionID: "ses_1",
      type: "user",
      delivery: "queue",
      payload: { text: "b" },
      time: { created: 2 },
    },
  ])
  await read
  expect(data.session.pending.list("ses_1").map((item) => item.id)).toEqual(["msg_new"])
  expect(data.session.message.list("ses_1").map((item) => item.id)).toEqual(["msg_new"])
})

test("a transcript read keeps live updates that landed while it was in flight", async () => {
  const assistant = {
    id: "msg_a",
    type: "assistant",
    agent: "build",
    model: { id: "test", providerID: "buff" },
    content: [],
    time: { created: 2 },
  } as unknown as SessionMessageInfo
  const reads = [Promise.withResolvers<SessionMessageInfo[]>(), Promise.withResolvers<SessionMessageInfo[]>()]
  let call = 0
  const { source, data } = setup({
    "message.list": () => reads[call++]!.promise.then((items) => ({ data: items.toReversed(), cursor: {} })),
  })
  const first = data.session.message.sync("ses_1")
  reads[0]!.resolve([user("msg_u", 1), assistant])
  await first
  data.session.message.invalidate("ses_1")
  // A reconnect re-reads the transcript; the server answered before the text, which arrives live.
  const second = data.session.message.sync("ses_1")
  source.publish(event("session.text.started", { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 0 }))
  source.publish(
    event("session.text.ended", { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 0, text: "after" }),
  )
  reads[1]!.resolve([user("msg_u", 1), assistant])
  await second
  const message = data.session.message.get("ses_1", "msg_a")
  expect(message?.type === "assistant" ? message.content : undefined).toEqual([{ type: "text", text: "after" }])
})
