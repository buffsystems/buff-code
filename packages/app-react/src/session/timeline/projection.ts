// The session timeline's row projection (#584) over the core data snapshot. The rows come from
// the Solid window's projection (session-ui Timeline), reusing every unchanged row object, so a
// memoised React row keeps its identity. A text or reasoning delta that keeps the row structure
// skips the projection entirely: rows read their content from the data store themselves.

import type { SessionInboxInfo, SessionMessageInfo, SessionStatus } from "@opencode/client/promise"
import { visibleTimelineMessages } from "@opencode/app/react-reuse/timeline-projection"
import type { TimelineDetail } from "@opencode/session-ui/timeline/detail"
import { createTimelineProjection, type ReasoningMode } from "@opencode/session-ui/timeline/projection"
import type { DataState } from "../../core/data/state"
import { createStore, type Store } from "../../core/store"

export type TimelineProjection = ReturnType<typeof createTimelineProjection> & {
  /** The visible transcript the rows were projected from. */
  messages: SessionMessageInfo[]
}

export type TimelineSettings = {
  detail: TimelineDetail
}

type Inputs = {
  messages: SessionMessageInfo[]
  pending: SessionInboxInfo[]
  revert: string | undefined
  busy: boolean
  detail: TimelineDetail
}

const none: SessionMessageInfo[] = []
const noPending: SessionInboxInfo[] = []
const idle: SessionStatus = { type: "idle" }
const busy: SessionStatus = { type: "busy" }

export function reasoningMode(detail: TimelineDetail): ReasoningMode {
  if (detail.thinking.placement === "hidden") return "hidden"
  return detail.thinking.details === "expanded" ? "full" : "compact"
}

/**
 * A selector of one session's projection. It keeps the previous result, so it returns the same
 * object while nothing structural changed — a streaming delta costs a shallow comparison.
 */
export function createProjectionSelector(sessionID: string, detail: TimelineDetail) {
  const last: { inputs?: Inputs; value?: TimelineProjection } = {}
  return (state: DataState) => {
    const inputs: Inputs = {
      messages: state.session.message[sessionID] ?? none,
      pending: state.session.pending[sessionID] ?? noPending,
      revert: state.session.info[sessionID]?.revert?.messageID,
      busy: state.session.active[sessionID] === "running",
      detail,
    }
    const previous = last.inputs
    if (previous && last.value && sameInputs(previous, inputs)) return last.value
    const value =
      previous && last.value && sameStructure(previous, inputs)
        ? last.value
        : project(inputs, last.value)
    last.inputs = inputs
    last.value = value
    return value
  }
}

/** One session's projection as a store of its own, following the server's data. */
export function createProjectionStore(data: Store<DataState>, sessionID: string, detail: TimelineDetail) {
  const select = createProjectionSelector(sessionID, detail)
  const store = createStore(select(data.get()))
  const stop = data.subscribe(() => {
    const next = select(data.get())
    store.set(() => next)
  })
  return { store, dispose: stop }
}

/** The status the projection was built with, as the Solid session model derives it. */
export function sessionStatus(state: DataState, sessionID: string) {
  return state.session.active[sessionID] === "running" ? busy : idle
}

function project(inputs: Inputs, previous: TimelineProjection | undefined): TimelineProjection {
  const steers = new Set(
    inputs.pending.flatMap((item) => (item.type === "user" && item.delivery === "steer" ? [item.id] : [])),
  )
  const messages = visibleTimelineMessages(inputs.messages, inputs.pending, inputs.revert)
  const mode = reasoningMode(inputs.detail)
  return {
    ...createTimelineProjection({
      sessionMessages: messages,
      status: inputs.busy ? busy : idle,
      reasoningMode: mode,
      shellToolDefaultOpen: inputs.detail.shell.details === "expanded",
      editToolDefaultOpen: inputs.detail.edit.details === "expanded",
      timelineDetail: inputs.detail,
      pendingUserMessageIDs: steers,
      previousRows: previous?.rows,
    }),
    messages,
  }
}

function sameInputs(previous: Inputs, next: Inputs) {
  return (
    previous.messages === next.messages &&
    previous.pending === next.pending &&
    previous.revert === next.revert &&
    previous.busy === next.busy &&
    previous.detail === next.detail
  )
}

// Only the streamed text of one part changed, and it stayed empty or non-empty: the rows are the
// same, since a part's emptiness is all the projection reads of its text.
function sameStructure(previous: Inputs, next: Inputs) {
  if (
    previous.pending !== next.pending ||
    previous.revert !== next.revert ||
    previous.busy !== next.busy ||
    previous.detail !== next.detail ||
    previous.messages.length !== next.messages.length
  )
    return false
  const changed = next.messages.flatMap((message, index) => (message === previous.messages[index] ? [] : [index]))
  if (changed.length !== 1) return changed.length === 0
  const before = previous.messages[changed[0]!]
  const after = next.messages[changed[0]!]
  if (before?.type !== "assistant" || after?.type !== "assistant") return false
  if (!sameExceptContent(before, after) || before.content.length !== after.content.length) return false
  const parts = after.content.flatMap((part, index) => (part === before.content[index] ? [] : [index]))
  if (parts.length !== 1) return parts.length === 0
  const old = before.content[parts[0]!]
  const part = after.content[parts[0]!]
  if (!old || !part || old.type === "tool" || part.type !== old.type) return false
  if (part.type === "reasoning" && old.type === "reasoning" && part.time !== old.time) return false
  return !!old.text.trim() === !!part.text.trim()
}

function sameExceptContent(before: object, after: object) {
  const a = Object.entries(before)
  const b = new Map(Object.entries(after))
  return a.length === b.size && a.every(([key, value]) => key === "content" || b.get(key) === value)
}
