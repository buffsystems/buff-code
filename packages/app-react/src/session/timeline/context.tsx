// What a timeline row reads (#584). Rows subscribe to the server's data with narrow selectors —
// one message, one content part — so a streaming part re-renders only its own row.

import type { PromptFileAttachment, SessionMessageInfo } from "@opencode/client/promise"
import type { SessionTurnFailure } from "@opencode/session-ui/actions"
import type { TimelineDetail } from "@opencode/session-ui/timeline/detail"
import { Timeline, type PartRef } from "@opencode/session-ui/timeline/projection"
import { createContext, use, type ReactNode } from "react"
import type { DataState } from "../../core/data/state"
import type { Server } from "../../core/servers"
import type { Store } from "../../core/store"
import { useStore } from "../../react/use-store"
import type { TimelineProjection } from "./projection"
import type { Disclosure } from "./virtualizer"

/** What the session screen lends the timeline's rows: navigation and Buff's own cards. */
export type TimelineActions = {
  navigateToSession?: (sessionID: string) => void
  sessionHref?: (sessionID: string) => string
  openAttachment?: (file: PromptFileAttachment) => void
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  /** Buff (#458): the card of a failed turn; without it the failure shows as text. */
  turnFailure?: (failure: SessionTurnFailure) => ReactNode
  /** Buff (#449): under a finished turn's answer — the files it changed. */
  turnSummary?: (input: { userMessageID: string }) => ReactNode
}

export type TimelineDisclosure = {
  store: Store<Disclosure>
  patchGroupKeys: Map<string, string>
  value: (key: string) => boolean | undefined
  set: (key: string, open: boolean) => void
}

export type TimelineContextValue = {
  server: Server
  sessionID: string
  projection: Store<TimelineProjection>
  disclosure: TimelineDisclosure
  detail: TimelineDetail
  centered: boolean
  actions: TimelineActions
  anchor: (messageID: string) => string
  /** What is being prepared before the session exists (a new worktree), shown where work shows. */
  preparing?: string
}

const TimelineContext = createContext<TimelineContextValue | undefined>(undefined)

export function TimelineProvider(props: { value: TimelineContextValue; children?: ReactNode }) {
  return <TimelineContext value={props.value}>{props.children}</TimelineContext>
}

export function useTimeline() {
  const value = use(TimelineContext)
  if (!value) throw new Error("useTimeline must be used inside TimelineProvider")
  return value
}

// One index per transcript array: every row's lookup shares it until the transcript changes.
const indexes = new WeakMap<SessionMessageInfo[], Map<string, SessionMessageInfo>>()
const emptyIndex = new Map<string, SessionMessageInfo>()

export function messageIndex(messages: SessionMessageInfo[] | undefined) {
  if (!messages) return emptyIndex
  const known = indexes.get(messages)
  if (known) return known
  const index = new Map(messages.map((message) => [message.id, message] as const))
  indexes.set(messages, index)
  return index
}

export function findMessage(state: DataState, sessionID: string, messageID: string) {
  return messageIndex(state.session.message[sessionID]).get(messageID)
}

/** One message of this session, live. */
export function useMessage(messageID: string) {
  const timeline = useTimeline()
  return useStore(timeline.server.data.state, (state) => findMessage(state, timeline.sessionID, messageID))
}

/** One assistant content part, live: re-renders only when that part changes. */
export function useContent(ref: PartRef) {
  const timeline = useTimeline()
  return useStore(timeline.server.data.state, (state) =>
    Timeline.resolveContent(findMessage(state, timeline.sessionID, ref.messageID), ref.partID),
  )
}

export function useBusy() {
  const timeline = useTimeline()
  return useStore(timeline.server.data.state, (state) => state.session.active[timeline.sessionID] === "running")
}

export function useProjection<Selected>(select: (projection: TimelineProjection) => Selected) {
  return useStore(useTimeline().projection, select)
}

/** A disclosure choice of this timeline (a tool, a group, a file), kept with its measurements. */
export function useDisclosure(key: string) {
  const timeline = useTimeline()
  const value = useStore(timeline.disclosure.store, (state) => state[key])
  return [value, (open: boolean) => timeline.disclosure.set(key, open)] as const
}
