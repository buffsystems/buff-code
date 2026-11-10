// Окно контекста (#837, эпик #783): слой данных Solid — событие session.context.selected меняет
// лимит сессии и кладёт строку context-switched в загруженную ленту; создание сессии несёт лимит.
import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo } from "../src/promise"

const sessionID = "ses_context"
const info: SessionInfo = {
  id: sessionID,
  projectID: "prj",
  title: "Context",
  location: { directory: "/project" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
}
const event = { id: "evt_context_1", created: 10, durable: { aggregateID: sessionID, seq: 1, version: 1 } }

function setup() {
  const requests: { method: string; path: string; body?: unknown }[] = []
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const body = request.method === "POST" ? await request.json() : undefined
      requests.push({ method: request.method, path: url.pathname, body })
      if (request.method === "GET" && /\/message$/.test(url.pathname)) return Response.json({ data: [], cursor: {} })
      if (request.method === "GET" && /\/message\/msg_/.test(url.pathname))
        return Response.json({
          data: { id: url.pathname.split("/").at(-1), type: "context-switched", limit: { context: 200_000 }, time: { created: 10 } },
        })
      if (request.method === "POST" && url.pathname === "/api/session")
        return Response.json({ data: { ...info, id: body.id, limit: body.limit } })
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    },
  })
  const root = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  const emit = (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details }))
  return { data: root.data, requests, emit, [Symbol.dispose]: root.dispose }
}

async function wait(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error("Timed out")
}

test("a context limit event updates the session and leaves a row in a loaded transcript", async () => {
  using fixture = setup()
  fixture.data.session.remember(info)
  await fixture.data.session.message.sync(sessionID)
  fixture.emit({ ...event, type: "session.context.selected", data: { sessionID, limit: { context: 200_000 } } } as OpenCodeEvent)
  expect(fixture.data.session.get(sessionID)?.limit).toEqual({ context: 200_000 })
  expect(fixture.data.session.message.list(sessionID)).toMatchObject([
    { id: "msg_context_1", type: "context-switched", limit: { context: 200_000 } },
  ])
  // The durable row replaces the live one once read back.
  await wait(() => fixture.requests.some((item) => /\/message\/msg_context_1$/.test(item.path)))
  await wait(() => fixture.data.session.message.list(sessionID).length === 1)
  fixture.emit({ ...event, id: "evt_context_2", type: "session.context.selected", data: { sessionID, previous: { context: 200_000 } } } as OpenCodeEvent)
  expect(fixture.data.session.get(sessionID)?.limit).toBeUndefined()
})

test("an unloaded transcript only takes the limit", () => {
  using fixture = setup()
  fixture.data.session.remember(info)
  fixture.emit({ ...event, type: "session.context.selected", data: { sessionID, limit: { context: 64_000 } } } as OpenCodeEvent)
  expect(fixture.data.session.get(sessionID)?.limit).toEqual({ context: 64_000 })
  expect(fixture.data.session.message.list(sessionID)).toEqual([])
})

test("a created session carries its cap from the start", async () => {
  using fixture = setup()
  const created = fixture.data.session.create({ limit: { context: 64_000 } })
  expect(fixture.data.session.get(created.id)?.limit).toEqual({ context: 64_000 })
  await created.request
  const post = fixture.requests.find((item) => item.method === "POST" && item.path === "/api/session")
  expect(post?.body).toMatchObject({ limit: { context: 64_000 } })
})
