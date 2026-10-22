// The shape of one server's data (#584), as the Solid data layer keeps it, but immutable: every
// update returns a new snapshot sharing what did not change, so a React row keeps its identity
// while the rest of a transcript streams.

import type {
  AgentInfo,
  CommandInfo,
  ConfigEntry,
  FormInfo,
  IntegrationInfo,
  LocationGetOutput,
  LocationRef,
  McpResource,
  McpServer,
  ModelInfo,
  PermissionRequest,
  PermissionSavedInfo,
  Project,
  ProviderInfo,
  ReferenceInfo,
  SessionInboxInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  ShellInfo,
  SkillInfo,
  VcsInfo,
  WebSearchProvider,
} from "@opencode/client/promise"

export type SessionStatus = "idle" | "running"

// Global MCP elicitations temporarily use "global" instead of a real session ID, so the server
// cannot recover their Location when settling them. Preserve the event Location until MCP
// elicitations carry session ownership.
export type FormWithLocation = FormInfo & { readonly location?: LocationRef }
export type ShellWithLocation = ShellInfo & { readonly location: LocationRef }

export type LocationData = {
  info?: LocationGetOutput
  vcs?: VcsInfo
  agent?: AgentInfo[]
  command?: CommandInfo[]
  config?: ConfigEntry[]
  integration?: IntegrationInfo[]
  mcpServer?: McpServer[]
  mcpResource?: McpResource[]
  model?: ModelInfo[]
  provider?: ProviderInfo[]
  reference?: ReferenceInfo[]
  websearch?: WebSearchProvider[]
  // Running shell commands of this location by shell id; exited ones are removed.
  shell?: Record<string, ShellWithLocation>
  skill?: SkillInfo[]
}

export type SessionData = {
  info: Record<string, SessionInfo>
  // Family index keyed by a family's root (or furthest-known ancestor while the true root is not
  // loaded): every session ID in that family, including the key itself once its info arrives.
  family: Record<string, string[]>
  active: Record<string, SessionStatus>
  message: Record<string, SessionMessageInfo[]>
  messageCursor: Record<string, string | undefined>
  messageLoading: Record<string, boolean>
  pending: Record<string, SessionInboxInfo[]>
  permission: Record<string, PermissionRequest[]>
  // Pending forms keyed by owner: a session ID or the temporary "global" elicitation sentinel.
  form: Record<string, FormWithLocation[]>
}

export type DataState = {
  session: SessionData
  project: { info: Record<string, Project>; permission: Record<string, PermissionSavedInfo[]> }
  location: Record<string, LocationData>
  defaultLocation: LocationRef
}

export function emptyData(directory: string): DataState {
  return {
    session: {
      info: {},
      family: {},
      active: {},
      message: {},
      messageCursor: {},
      messageLoading: {},
      pending: {},
      permission: {},
      form: {},
    },
    project: { info: {}, permission: {} },
    location: {},
    defaultLocation: { directory },
  }
}

export function locationKey(location: LocationRef) {
  return JSON.stringify([location.directory, location.workspaceID])
}

/** Replace one session-keyed map of the session data. */
export function withSession<Key extends keyof SessionData>(
  state: DataState,
  key: Key,
  update: (current: SessionData[Key]) => SessionData[Key],
): DataState {
  const next = update(state.session[key])
  if (next === state.session[key]) return state
  return { ...state, session: { ...state.session, [key]: next } }
}

export function withLocation(state: DataState, key: string, update: (data: LocationData | undefined) => LocationData) {
  return { ...state, location: { ...state.location, [key]: update(state.location[key]) } }
}

export function setEntry<Value>(record: Record<string, Value>, id: string, value: Value) {
  return record[id] === value ? record : { ...record, [id]: value }
}

export function dropEntry<Value>(record: Record<string, Value>, id: string) {
  if (!(id in record)) return record
  const next = { ...record }
  delete next[id]
  return next
}

/** Update one session's info when it is loaded; unknown sessions are left alone. */
export function editInfo(state: DataState, sessionID: string, update: (info: SessionInfo) => SessionInfo) {
  const info = state.session.info[sessionID]
  if (!info) return state
  return withSession(state, "info", (all) => setEntry(all, sessionID, update(info)))
}

/** Update one session's transcript, creating it empty when it was never loaded. */
export function editMessages(
  state: DataState,
  sessionID: string,
  update: (messages: SessionMessageInfo[]) => SessionMessageInfo[],
) {
  const current = state.session.message[sessionID] ?? []
  const next = update(current)
  if (next === current && state.session.message[sessionID]) return state
  return withSession(state, "message", (all) => ({ ...all, [sessionID]: next }))
}

export function appendMessage(messages: SessionMessageInfo[], item: SessionMessageInfo) {
  if (messages.some((message) => message.id === item.id)) return messages
  return [...messages, item]
}

/** Insert a row, or replace the row with the same id in place. */
export function upsertMessage(messages: SessionMessageInfo[], item: SessionMessageInfo) {
  const position = messages.findIndex((message) => message.id === item.id)
  if (position === -1) return [...messages, item]
  return messages.with(position, item)
}

export function replaceMessage(
  messages: SessionMessageInfo[],
  position: number,
  update: (message: SessionMessageInfo) => SessionMessageInfo,
) {
  const current = messages[position]
  if (!current) return messages
  const next = update(current)
  return next === current ? messages : messages.with(position, next)
}

// Streaming events target one assistant message and, within it, the latest part of a kind. A
// missing target means the row was never loaded or was evicted; the event is dropped.
export function editAssistant(
  messages: SessionMessageInfo[],
  messageID: string,
  update: (assistant: SessionMessageAssistant) => SessionMessageAssistant,
) {
  const position = messages.findLastIndex((message) => message.id === messageID)
  return replaceMessage(messages, position, (message) => (message.type === "assistant" ? update(message) : message))
}

type Content = SessionMessageAssistant["content"][number]

/** Replace the latest content part that matches; the assistant is unchanged when none does. */
export function editLastContent<Part extends Content>(
  assistant: SessionMessageAssistant,
  match: (part: Content) => part is Part,
  update: (part: Part) => Content,
) {
  const position = assistant.content.findLastIndex(match)
  const part = assistant.content[position]
  if (!part || !match(part)) return assistant
  return { ...assistant, content: assistant.content.with(position, update(part)) }
}

export function activeAssistantPosition(messages: SessionMessageInfo[]) {
  return messages.findLastIndex((message) => message.type === "assistant" && !message.time.completed)
}
