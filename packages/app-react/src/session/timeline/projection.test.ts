import { expect, test } from "bun:test"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { event, model, session } from "../../core/data/fixtures"
import { reduceEvent } from "../../core/data/reduce"
import { emptyData, type DataState } from "../../core/data/state"
import { createProjectionSelector } from "./projection"

const detail = timelinePresets[0].value
const ids = { sessionID: "ses_1", assistantMessageID: "msg_b" }
const fold = (state: DataState, ...events: Parameters<typeof reduceEvent>[1][]) => events.reduce(reduceEvent, state)

function started() {
  const state = emptyData("/repo")
  const loaded: DataState = {
    ...state,
    session: {
      ...state.session,
      info: { ses_1: session("ses_1") },
      message: { ses_1: [{ id: "msg_a", type: "user", text: "hi", time: { created: 1 } }] },
    },
  }
  return fold(
    loaded,
    event("session.execution.started", { sessionID: "ses_1" }),
    event("session.step.started", { ...ids, agent: "build", model, started: 2 }),
    event("session.text.started", { ...ids, ordinal: 0 }),
    event("session.text.delta", { ...ids, ordinal: 0, delta: "Hel" }),
  )
}

test("projects a turn into keyed rows", () => {
  const select = createProjectionSelector("ses_1", detail)
  const projection = select(started())
  expect(projection.rows.map((row) => row._tag)).toEqual(["UserMessage", "AssistantPart"])
  expect(projection.activeMessageID).toBe("msg_a")
})

test("a text delta that keeps the part non-empty reuses the whole projection", () => {
  const select = createProjectionSelector("ses_1", detail)
  const state = started()
  const before = select(state)
  const after = select(reduceEvent(state, event("session.text.delta", { ...ids, ordinal: 0, delta: "lo" })))
  expect(after).toBe(before)
})

test("a part that becomes visible re-projects and keeps the unchanged rows", () => {
  const select = createProjectionSelector("ses_1", detail)
  const state = fold(
    started(),
    event("session.text.ended", { ...ids, ordinal: 0, text: "Hello" }),
    event("session.text.started", { ...ids, ordinal: 1 }),
  )
  const before = select(state)
  const after = select(reduceEvent(state, event("session.text.delta", { ...ids, ordinal: 1, delta: "More" })))
  expect(after).not.toBe(before)
  expect(after.rows).toHaveLength(3)
  expect(after.rows[0]).toBe(before.rows[0]!)
  expect(after.rows[1]).toBe(before.rows[1]!)
})

test("a finished step re-projects", () => {
  const select = createProjectionSelector("ses_1", detail)
  const state = started()
  const before = select(state)
  const after = select(
    reduceEvent(
      state,
      event("session.step.ended", {
        ...ids,
        finish: "stop",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    ),
  )
  expect(after).not.toBe(before)
  expect(after.rows.map((row) => row._tag)).toEqual(["UserMessage", "AssistantPart"])
})
