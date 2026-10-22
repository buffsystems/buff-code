import { expect, test } from "bun:test"
import type { OpenCodeEvent, PermissionRequest, SessionInfo } from "@opencode/client/promise"
import { createPermissionAutoApprover } from "./auto-approve"
import type { ConnectionState } from "./connection"
import { fakeApi } from "./data/fake-api"
import { emptyData, withSession } from "./data/state"
import { createEventSource } from "./events"
import { createStore } from "./store"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function request(id: string, sessionID: string): PermissionRequest {
  return { id, sessionID, action: "shell", resources: ["git status"], metadata: {}, save: [] } as PermissionRequest
}

function session(id: string, directory: string) {
  return { id, location: { directory } } as SessionInfo
}

function setup(input: { pending?: Record<string, PermissionRequest[]>; active?: string[]; enabled?: boolean }) {
  const sessions: Record<string, SessionInfo> = { ses_a: session("ses_a", "/a"), ses_b: session("ses_b", "/b") }
  const fake = fakeApi({
    "session.active": () => Object.fromEntries((input.active ?? []).map((id) => [id, { type: "running" }])),
    "permission.request.list": (query: { location: { directory: string } }) => ({
      data: input.pending?.[query.location.directory] ?? [],
    }),
    "permission.reply": () => undefined,
  })
  const events = createEventSource()
  const connection = createStore<ConnectionState>({ status: "connecting", attempt: 0 })
  const state = createStore(emptyData(""))
  const enabled = createStore(input.enabled ?? true)
  const synced: string[] = []
  const stop = createPermissionAutoApprover({
    server: {
      api: () => fake.api,
      event: events.event,
      connection,
      data: {
        state,
        session: {
          get: (id: string) => state.get().session.info[id],
          invalidate: () => undefined,
          sync: async (id: string) => {
            synced.push(id)
            state.set((current) => withSession(current, "info", (info) => ({ ...info, [id]: sessions[id]! })))
          },
        },
      },
    },
    enabled,
  })
  const replies = () => fake.called("permission.reply").map((call) => call.input)
  return { fake, events, connection, state, enabled, synced, stop, replies }
}

test("a connect sweeps the active sessions' locations and answers what is pending once", async () => {
  const run = setup({ active: ["ses_a"], pending: { "/a": [request("per_1", "ses_a")] } })
  run.connection.set(() => ({ status: "connected", attempt: 0 }))
  await flush()
  await flush()
  expect(run.synced).toEqual(["ses_a"])
  expect(run.fake.called("permission.request.list").map((call) => call.input)).toEqual([
    { location: { directory: "/a" } },
  ])
  expect(run.replies()).toEqual([{ sessionID: "ses_a", requestID: "per_1", decision: "once" }])
  run.stop()
})

test("an asked event is answered only while the setting is on", async () => {
  const run = setup({ enabled: false })
  const asked = (id: string) =>
    ({ id: `evt_${id}`, type: "permission.asked", data: request(id, "ses_a") }) as OpenCodeEvent
  run.events.publish(asked("per_off"))
  run.enabled.set(() => true)
  run.events.publish(asked("per_on"))
  run.events.publish(asked("per_on"))
  await flush()
  expect(run.replies()).toEqual([{ sessionID: "ses_a", requestID: "per_on", decision: "once" }])
  run.stop()
})

test("a request synced into the store is answered", async () => {
  const run = setup({})
  run.state.set((current) => withSession(current, "permission", () => ({ ses_b: [request("per_s", "ses_b")] })))
  await flush()
  expect(run.replies()).toEqual([{ sessionID: "ses_b", requestID: "per_s", decision: "once" }])
  run.stop()
})

test("turning the setting on sweeps a connected server", async () => {
  const run = setup({ enabled: false, active: ["ses_b"], pending: { "/b": [request("per_b", "ses_b")] } })
  run.connection.set(() => ({ status: "connected", attempt: 0 }))
  await flush()
  expect(run.fake.called("session.active")).toHaveLength(0)
  run.enabled.set(() => true)
  await flush()
  await flush()
  expect(run.replies()).toEqual([{ sessionID: "ses_b", requestID: "per_b", decision: "once" }])
  run.stop()
})
