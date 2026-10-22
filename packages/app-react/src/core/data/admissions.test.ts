import { afterEach, expect, test } from "bun:test"
import type { ConnectionState } from "../connection"
import { createEventSource } from "../events"
import { createStore } from "../store"
import { createData, type Data } from "./data"
import { fakeApi } from "./fake-api"
import { event } from "./fixtures"

let data: Data | undefined
afterEach(() => data?.dispose())

function setup(routes: Parameters<typeof fakeApi>[0]) {
  const server = fakeApi(routes)
  const source = createEventSource()
  const connection = createStore<ConnectionState>({ status: "connected", attempt: 0 })
  data = createData({ api: () => server.api, directory: "/repo", event: source.event, connection })
  return { server, source, data }
}

test("a prompt shows at once and keeps its row when the server takes it", async () => {
  const { server, source, data } = setup({ "session.prompt": (input: { id: string }) => ({ id: input.id }) })
  const sending = data.session.prompt({ id: "msg_1", sessionID: "ses_1", text: "hello" })
  expect(data.session.message.list("ses_1").map((item) => item.id)).toEqual(["msg_1"])
  expect(data.session.input.has("ses_1", "msg_1")).toBe(true)
  await sending
  source.publish(
    event("session.inbox.enqueued", {
      sessionID: "ses_1",
      inboxID: "msg_1",
      item: { type: "user", payload: { text: "hello" }, delivery: "steer" },
    }),
  )
  expect(data.session.message.list("ses_1")).toHaveLength(1)
  expect(server.called("session.prompt")[0]?.input).toMatchObject({ id: "msg_1", text: "hello" })
})

test("a rejected prompt rolls its optimistic row back", async () => {
  const { data } = setup({
    "session.prompt": () => {
      throw new Error("offline")
    },
  })
  await expect(data.session.prompt({ id: "msg_2", sessionID: "ses_1", text: "lost" })).rejects.toThrow("offline")
  expect(data.session.message.list("ses_1")).toHaveLength(0)
  expect(data.session.input.has("ses_1", "msg_2")).toBe(false)
})

test("prompts to a session that is still being created wait for it", async () => {
  const order: string[] = []
  const created = Promise.withResolvers<void>()
  const { data } = setup({
    "session.create": async (input: { id: string }) => {
      await created.promise
      order.push("create")
      return {
        id: input.id,
        projectID: "prj",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 1 },
        location: { directory: "/repo" },
      }
    },
    "session.prompt": (input: { id: string }) => {
      order.push("prompt")
      return { id: input.id }
    },
  })
  const session = data.session.create({ id: "ses_new" })
  expect(data.session.creating("ses_new")).toBe(true)
  expect(data.state.get().session.info.ses_new?.id).toBe("ses_new")
  const prompt = data.session.prompt({ id: "msg_3", sessionID: "ses_new", text: "first" })
  created.resolve()
  await Promise.all([session.request, prompt])
  expect(order).toEqual(["create", "prompt"])
})

test("a failed create removes the session it showed", async () => {
  const { data } = setup({
    "session.create": () => {
      throw new Error("denied")
    },
  })
  const session = data.session.create({ id: "ses_gone" })
  await expect(session.request).rejects.toThrow("denied")
  expect(data.state.get().session.info.ses_gone).toBeUndefined()
})

test("a staged first prompt shows before its session exists, and is sent once under its id", async () => {
  const { server, data } = setup({ "session.prompt": (input: { id: string }) => ({ id: input.id }) })
  data.session.stage({ sessionID: "ses_9", id: "msg_9", text: "while the worktree is made" })
  expect(data.session.message.list("ses_9").map((item) => item.id)).toEqual(["msg_9"])
  await data.session.message.sync("ses_9")
  expect(server.called("message.list")).toHaveLength(0)
  await data.session.prompt({ id: "msg_9", sessionID: "ses_9", text: "while the worktree is made" })
  expect(data.session.message.list("ses_9")).toHaveLength(1)
  expect(server.called("session.prompt")).toHaveLength(1)
})

test("a staged prompt that is never sent, or is refused, leaves the transcript", async () => {
  const { data } = setup({
    "session.prompt": () => {
      throw new Error("refused")
    },
  })
  data.session.stage({ sessionID: "ses_9", id: "msg_9", text: "x" })
  data.session.unstage("ses_9", "msg_9")
  expect(data.session.message.list("ses_9")).toHaveLength(0)
  data.session.stage({ sessionID: "ses_9", id: "msg_10", text: "y" })
  await expect(data.session.prompt({ id: "msg_10", sessionID: "ses_9", text: "y" })).rejects.toThrow("refused")
  expect(data.session.message.list("ses_9")).toHaveLength(0)
})
