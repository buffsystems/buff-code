import { expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import { event, model, session } from "./fixtures"
import { reduceEvent } from "./reduce"
import { emptyData, type DataState } from "./state"

const fold = (state: DataState, ...events: Parameters<typeof reduceEvent>[1][]) => events.reduce(reduceEvent, state)
const loaded = (sessionID = "ses_1") => {
  const state = emptyData("/repo")
  return {
    ...state,
    session: { ...state.session, info: { [sessionID]: session(sessionID) }, message: { [sessionID]: [] } },
  }
}
const step = (sessionID = "ses_1", assistantMessageID = "msg_a") =>
  event("session.step.started", { sessionID, assistantMessageID, agent: "build", model, started: 10 })
const assistantOf = (state: DataState, id = "msg_a") =>
  state.session.message.ses_1?.find(
    (item): item is SessionMessageAssistant => item.id === id && item.type === "assistant",
  )

test("a streamed text builds one assistant row whose untouched parts keep their identity", () => {
  const started = fold(
    loaded(),
    step(),
    event("session.reasoning.started", { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 0 }),
    event("session.reasoning.ended", { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 0, text: "think" }),
    event("session.text.started", { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 1 }),
  )
  const reasoning = assistantOf(started)?.content[0]
  const next = fold(
    started,
    event("session.text.delta", { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 1, delta: "Hel" }),
    event("session.text.delta", { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 1, delta: "lo" }),
  )
  expect(assistantOf(next)?.content[1]).toEqual({ type: "text", text: "Hello" })
  expect(assistantOf(next)?.content[0]).toBe(reasoning)
  expect(started.session.message.ses_1?.[0]).not.toBe(next.session.message.ses_1?.[0])
})

test("an event for another session leaves this session's transcript identical", () => {
  const state = fold(
    { ...loaded(), session: { ...loaded().session, message: { ses_1: [], ses_2: [] } } },
    step("ses_1"),
    step("ses_2", "msg_b"),
  )
  const next = reduceEvent(
    state,
    event("session.text.started", { sessionID: "ses_2", assistantMessageID: "msg_b", ordinal: 0 }),
  )
  expect(next.session.message.ses_1).toBe(state.session.message.ses_1)
})

test("a tool part runs from streaming input to completion", () => {
  const ids = { sessionID: "ses_1", assistantMessageID: "msg_a", id: "call_1" }
  const state = fold(
    loaded(),
    step(),
    event("session.tool.input.started", { ...ids, name: "read" }),
    event("session.tool.input.delta", { ...ids, delta: '{"path":' }),
    event("session.tool.input.ended", { ...ids, text: '{"path":"a"}' }),
    event("session.tool.called", { ...ids, input: { path: "a" }, executed: true }),
    event("session.tool.success", { ...ids, metadata: {}, content: [{ type: "text", text: "ok" }], executed: true }),
  )
  expect(assistantOf(state)?.content[0]).toMatchObject({
    type: "tool",
    id: "call_1",
    executed: true,
    state: { status: "completed", input: { path: "a" }, content: [{ type: "text", text: "ok" }] },
  })
})

test("a new step closes the previous open assistant", () => {
  const state = fold(loaded(), step("ses_1", "msg_a"), step("ses_1", "msg_b"))
  expect(assistantOf(state, "msg_a")?.time.completed).toBeDefined()
  expect(assistantOf(state, "msg_b")?.time.completed).toBeUndefined()
})

test("execution start and end set the session status and append the idle marker", () => {
  const running = reduceEvent(loaded(), event("session.execution.started", { sessionID: "ses_1" }))
  expect(running.session.active.ses_1).toBe("running")
  const idle = reduceEvent(running, event("session.execution.succeeded", { sessionID: "ses_1" }))
  expect(idle.session.active.ses_1).toBe("idle")
  expect(idle.session.message.ses_1?.at(-1)).toMatchObject({ type: "idle", outcome: "succeeded" })
})

test("an enqueued prompt is pending and visible; delivery moves it to the end of the transcript", () => {
  const enqueued = fold(
    loaded(),
    event("session.inbox.enqueued", {
      sessionID: "ses_1",
      inboxID: "msg_u",
      item: { type: "user", delivery: "steer", payload: { text: "hi" } },
    }),
    step(),
  )
  expect(enqueued.session.pending.ses_1?.map((item) => item.id)).toEqual(["msg_u"])
  expect(enqueued.session.message.ses_1?.map((item) => item.id)).toEqual(["msg_u", "msg_a"])
  const delivered = reduceEvent(
    enqueued,
    event("session.inbox.delivered", { sessionID: "ses_1", inboxID: "msg_u" }, { created: 99 }),
  )
  expect(delivered.session.pending.ses_1).toEqual([])
  expect(delivered.session.message.ses_1?.map((item) => item.id)).toEqual(["msg_a", "msg_u"])
  expect(delivered.session.message.ses_1?.at(-1)?.time.created).toBe(99)
})

test("a cancelled prompt leaves both pending and the transcript", () => {
  const state = fold(
    loaded(),
    event("session.inbox.enqueued", {
      sessionID: "ses_1",
      inboxID: "msg_u",
      item: { type: "user", delivery: "queue", payload: { text: "hi" } },
    }),
    event("session.inbox.cancelled", { sessionID: "ses_1", inboxID: "msg_u" }),
  )
  expect(state.session.pending.ses_1).toEqual([])
  expect(state.session.message.ses_1).toEqual([])
})

test("a deleted session disappears from every map and its family", () => {
  const base = loaded()
  const state = {
    ...base,
    session: { ...base.session, family: { ses_1: ["ses_1", "ses_2"] }, active: { ses_1: "running" as const } },
  }
  const next = reduceEvent(state, event("session.deleted", { sessionID: "ses_1" }))
  expect(next.session.info.ses_1).toBeUndefined()
  expect(next.session.message.ses_1).toBeUndefined()
  expect(next.session.active.ses_1).toBeUndefined()
  expect(next.session.family).toEqual({ ses_1: ["ses_2"] })
})

test("a committed revert drops rows and pending items at or after the boundary", () => {
  const state = fold(
    loaded(),
    event("session.inbox.enqueued", {
      sessionID: "ses_1",
      inboxID: "msg_1",
      item: { type: "user", delivery: "steer", payload: { text: "a" } },
    }),
    event("session.inbox.enqueued", {
      sessionID: "ses_1",
      inboxID: "msg_3",
      item: { type: "user", delivery: "queue", payload: { text: "b" } },
    }),
    event("session.revert.committed", { sessionID: "ses_1", to: "msg_2" }),
  )
  expect(state.session.message.ses_1?.map((item) => item.id)).toEqual(["msg_1"])
  expect(state.session.pending.ses_1?.map((item) => item.id)).toEqual(["msg_1"])
})

test("project, usage, permission and shell events update their maps", () => {
  const state = fold(
    loaded(),
    event("session.usage.updated", {
      sessionID: "ses_1",
      cost: 2,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
    event("permission.asked", { id: "per_1", sessionID: "ses_1", action: "edit", resources: [], metadata: {} }),
    event(
      "shell.created",
      {
        info: {
          id: "shl_1",
          command: "ls",
          status: "running",
          cwd: "/repo",
          shell: "bash",
          file: "/tmp/shl_1",
          time: { started: 1 },
          metadata: {},
        },
      },
      { location: { directory: "/repo" } },
    ),
  )
  expect(state.session.info.ses_1?.cost).toBe(2)
  expect(state.session.permission.ses_1?.map((request) => request.id)).toEqual(["per_1"])
  expect(Object.keys(state.location['["/repo",null]']?.shell ?? {})).toEqual(["shl_1"])
  const replied = reduceEvent(
    state,
    event("permission.replied", { sessionID: "ses_1", requestID: "per_1", reply: "once" }),
  )
  expect(replied.session.permission.ses_1).toEqual([])
})
