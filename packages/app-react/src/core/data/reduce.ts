// Server events folded into the data snapshot (#584): the state transitions of the Solid data
// layer's handleEvent (packages/client/src/solid/data.ts), as a pure function. Reads the events
// trigger (refetches, revalidation) live in ./effects.

import type {
  OpenCodeEvent,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client/promise"
import { Worktree } from "@opencode/schema/worktree"
import {
  activeAssistantPosition,
  appendMessage,
  dropEntry,
  editAssistant,
  editInfo,
  editLastContent,
  editMessages,
  locationKey,
  replaceMessage,
  setEntry,
  upsertMessage,
  withLocation,
  withSession,
  type DataState,
  type SessionStatus,
} from "./state"

export const messageIDFromEvent = (eventID: string) => eventID.replace(/^evt_/, "msg_")

const isText = (part: { type: string }): part is SessionMessageAssistantText => part.type === "text"
const isOpenReasoning = (part: { type: string }): part is SessionMessageAssistantReasoning =>
  part.type === "reasoning" && !(part as SessionMessageAssistantReasoning).time?.completed
const isTool =
  (id: string) =>
  (part: { type: string }): part is SessionMessageAssistantTool =>
    part.type === "tool" && (part as SessionMessageAssistantTool).id === id

type EventOf<Type extends OpenCodeEvent["type"]> = Extract<OpenCodeEvent, { type: Type }>

export function reduceEvent(state: DataState, event: OpenCodeEvent): DataState {
  switch (event.type) {
    case "project.updated":
      return { ...state, project: { ...state.project, info: setEntry(state.project.info, event.data.id, event.data) } }
    case "session.deleted":
      return removeSession(state, event.data.sessionID)
    case "session.usage.updated":
      return editInfo(state, event.data.sessionID, (info) => ({
        ...info,
        cost: event.data.cost,
        tokens: event.data.tokens,
      }))
    case "session.agent.selected": {
      const previous = state.session.info[event.data.sessionID]?.agent
      return editMessages(
        editInfo(state, event.data.sessionID, (info) => ({ ...info, agent: event.data.agent })),
        event.data.sessionID,
        (messages) =>
          appendMessage(messages, {
            id: messageIDFromEvent(event.id),
            type: "agent-switched",
            agent: event.data.agent,
            previous,
            time: { created: event.created },
          }),
      )
    }
    case "session.model.selected": {
      const next = editInfo(state, event.data.sessionID, (info) => ({ ...info, model: event.data.model }))
      if (!next.session.message[event.data.sessionID]) return next
      return editMessages(next, event.data.sessionID, (messages) =>
        appendMessage(messages, {
          id: messageIDFromEvent(event.id),
          type: "model-switched",
          model: event.data.model,
          time: { created: event.created },
        }),
      )
    }
    case "session.permissions":
      return editInfo(state, event.data.sessionID, (info) => ({ ...info, permissions: event.data.permissions }))
    case "session.moved":
      return moveSession(state, event)
    case "worktree.resolved":
      return adoptWorktree(state, event)
    case "session.inbox.delivered":
      return deliverInbox(state, event)
    case "session.inbox.delivery.changed":
      return withSession(state, "pending", (all) => {
        const items = all[event.data.sessionID]
        const position = items?.findIndex((item) => item.id === event.data.inboxID) ?? -1
        const item = items?.[position]
        if (!items || !item || item.delivery === event.data.delivery) return all
        return { ...all, [event.data.sessionID]: items.with(position, { ...item, delivery: event.data.delivery }) }
      })
    case "session.inbox.cancelled":
      return retractInbox(state, event.data.sessionID, event.data.inboxID)
    case "session.inbox.enqueued":
      return admitInbox(state, {
        id: event.data.inboxID,
        sessionID: event.data.sessionID,
        time: { created: event.created },
        ...event.data.item,
      })
    case "session.instructions.updated": {
      // Mirror the projector: the initial baseline and empty-rendering deltas carry no text and
      // produce no transcript message.
      const text = event.data.text
      if (text === undefined) return state
      return editMessages(state, event.data.sessionID, (messages) =>
        appendMessage(messages, {
          id: messageIDFromEvent(event.id),
          type: "system",
          text,
          description: `Instructions updated: ${Object.keys(event.data.delta).join(", ")}`,
          metadata: event.metadata,
          time: { created: event.created },
        }),
      )
    }
    case "session.synthetic":
      return editMessages(state, event.data.sessionID, (messages) =>
        appendMessage(messages, {
          id: messageIDFromEvent(event.id),
          type: "synthetic",
          text: event.data.text,
          description: event.data.description,
          metadata: event.data.metadata,
          time: { created: event.created },
        }),
      )
    case "session.shell.started":
      return editMessages(state, event.data.sessionID, (messages) =>
        appendMessage(messages, {
          id: messageIDFromEvent(event.id),
          type: "shell",
          shellID: event.data.shell.id,
          command: event.data.shell.command,
          status: event.data.shell.status,
          exit: event.data.shell.exit,
          metadata:
            event.data.shell.metadata.background === true ? { ...event.metadata, background: true } : event.metadata,
          time: { created: event.created },
        }),
      )
    case "session.shell.ended":
      return editMessages(state, event.data.sessionID, (messages) => {
        const position = messages.findLastIndex((item) => item.type === "shell" && item.shellID === event.data.shell.id)
        return replaceMessage(messages, position, (item) =>
          item.type === "shell"
            ? {
                ...item,
                status: event.data.shell.status,
                exit: event.data.shell.exit,
                output: event.data.output,
                time: { ...item.time, completed: event.created },
              }
            : item,
        )
      })
    case "session.step.started":
      return editMessages(state, event.data.sessionID, (messages) => startStep(messages, event))
    case "session.step.streamed":
      return assistant(state, event, (item) => ({ ...item, time: { ...item.time, streamed: event.created } }))
    case "session.step.ended":
      return assistant(state, event, (item) => ({
        ...item,
        time: { ...item.time, completed: event.created },
        finish: event.data.finish,
        rawFinish: event.data.rawFinish,
        providerState: event.data.providerState,
        cost: event.data.cost,
        tokens: event.data.tokens,
        snapshot: event.data.snapshot ? { ...item.snapshot, end: event.data.snapshot } : item.snapshot,
      }))
    case "session.step.failed":
      return assistant(state, event, (item) => ({
        ...item,
        time: { ...item.time, completed: event.created },
        finish: event.data.finish ?? "error",
        rawFinish: event.data.rawFinish,
        providerState: event.data.providerState,
        error: event.data.error,
        retry: undefined,
        ...(event.data.cost !== undefined && event.data.tokens !== undefined
          ? { cost: event.data.cost, tokens: event.data.tokens }
          : {}),
      }))
    case "session.text.started":
      return assistant(state, event, (item) => ({ ...item, content: [...item.content, { type: "text", text: "" }] }))
    case "session.text.delta":
      return assistant(state, event, (item) =>
        editLastContent(item, isText, (text) => ({ ...text, text: text.text + event.data.delta })),
      )
    case "session.text.ended":
      return assistant(state, event, (item) =>
        editLastContent(item, isText, (text) => ({ ...text, text: event.data.text })),
      )
    case "session.tool.input.started":
      return assistant(state, event, (item) => ({
        ...item,
        content: [
          ...item.content,
          {
            type: "tool",
            id: event.data.id,
            name: event.data.name,
            time: { created: event.created },
            state: { status: "streaming", input: "" },
          },
        ],
      }))
    case "session.tool.input.delta":
      return tool(state, event, (part) =>
        part.state.status === "streaming"
          ? { ...part, state: { ...part.state, input: part.state.input + event.data.delta } }
          : part,
      )
    case "session.tool.input.ended":
      return tool(state, event, (part) =>
        part.state.status === "streaming" ? { ...part, state: { ...part.state, input: event.data.text } } : part,
      )
    case "session.tool.called":
      return tool(state, event, (part) => ({
        ...part,
        time: { ...part.time, ran: event.created },
        executed: event.data.executed,
        providerState: event.data.state,
        state: { status: "running", input: event.data.input, metadata: {} },
      }))
    case "session.tool.progress":
      return tool(state, event, (part) =>
        part.state.status === "running" ? { ...part, state: { ...part.state, metadata: event.data.metadata } } : part,
      )
    case "session.tool.success":
      return tool(state, event, (part) => {
        if (part.state.status !== "running") return part
        return {
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            metadata: event.data.metadata,
            content: [...event.data.content],
          },
          executed: event.data.executed || part.executed === true,
          providerResultState: event.data.resultState,
          time: { ...part.time, completed: event.created },
        }
      })
    case "session.tool.failed":
      return tool(state, event, (part) => {
        if (part.state.status !== "streaming" && part.state.status !== "running") return part
        return {
          ...part,
          state: {
            status: "error",
            error: event.data.error,
            input: typeof part.state.input === "string" ? {} : part.state.input,
            metadata: event.data.metadata,
            content: event.data.content,
          },
          executed: event.data.executed || part.executed === true,
          providerResultState: event.data.resultState,
          time: { ...part.time, completed: event.created },
        }
      })
    case "session.reasoning.started":
      return assistant(state, event, (item) => ({
        ...item,
        content: [
          ...item.content,
          { type: "reasoning", text: "", state: event.data.state, time: { created: event.created } },
        ],
      }))
    case "session.reasoning.delta":
      return assistant(state, event, (item) =>
        editLastContent(item, isOpenReasoning, (part) => ({ ...part, text: part.text + event.data.delta })),
      )
    case "session.reasoning.ended":
      return assistant(state, event, (item) =>
        editLastContent(item, isOpenReasoning, (part) => ({
          ...part,
          text: event.data.text,
          time: { created: part.time?.created ?? event.created, completed: event.created },
          ...(event.data.state !== undefined ? { state: event.data.state } : {}),
        })),
      )
    case "session.retry.scheduled":
      return assistant(state, event, (item) => ({
        ...item,
        retry: { attempt: event.data.attempt, at: event.data.at, error: event.data.error },
      }))
    case "session.execution.started":
      return setStatus(state, event.data.sessionID, "running")
    case "session.compaction.started":
      return editMessages(
        event.data.inputID ? removePending(state, event.data.sessionID, event.data.inputID) : state,
        event.data.sessionID,
        (messages) =>
          appendMessage(messages, {
            id: event.data.inputID ?? messageIDFromEvent(event.id),
            type: "compaction",
            status: "running",
            reason: event.data.reason,
            summary: "",
            recent: event.data.recent ?? "",
            time: { created: event.created },
          }),
      )
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
      return endExecution(state, event)
    case "session.revert.staged":
      return editInfo(state, event.data.sessionID, (info) => ({ ...info, revert: event.data.revert }))
    case "session.revert.cleared":
      return editInfo(state, event.data.sessionID, (info) => ({ ...info, revert: undefined }))
    case "session.revert.committed":
      return commitRevert(state, event)
    case "session.compaction.delta":
      return editMessages(state, event.data.sessionID, (messages) =>
        replaceMessage(messages, runningCompaction(messages), (item) =>
          item.type === "compaction" && item.status === "running"
            ? { ...item, summary: item.summary + event.data.text }
            : item,
        ),
      )
    case "session.compaction.ended":
      return editMessages(state, event.data.sessionID, (messages) => endCompaction(messages, event))
    case "session.compaction.failed":
      return editMessages(
        event.data.inputID ? removePending(state, event.data.sessionID, event.data.inputID) : state,
        event.data.sessionID,
        (messages) => failCompaction(messages, event),
      )
    case "permission.asked":
      return withSession(state, "permission", (all) => {
        const requests = all[event.data.sessionID] ?? []
        if (requests.some((request) => request.id === event.data.id)) return all
        return { ...all, [event.data.sessionID]: [...requests, event.data] }
      })
    case "permission.replied":
      return removePermission(state, event.data.sessionID, event.data.requestID)
    case "form.replied":
    case "form.cancelled":
      return removeForm(state, event.data.sessionID, event.data.id, event.location)
  }
  if (event.type === "credential.switched") return switchCredential(state, event)
  return reduceLocationEvent(state, event)
}

// The switched credential becomes the integration's first connection in every loaded location.
function switchCredential(state: DataState, event: EventOf<"credential.switched">) {
  return Object.keys(state.location).reduce(
    (current, key) =>
      withLocation(current, key, (data) => ({
        ...data,
        integration: data?.integration?.map((integration) => {
          if (integration.id !== event.data.integrationID) return integration
          const active = integration.connections.find(
            (connection) => connection.type === "credential" && connection.id === event.data.credentialID,
          )
          if (!active) return integration
          return {
            ...integration,
            connections: [active, ...integration.connections.filter((connection) => connection !== active)],
          }
        }),
      })),
    state,
  )
}

// Events whose state lives under the event's Location.
function reduceLocationEvent(state: DataState, event: OpenCodeEvent): DataState {
  const location = event.location
  if (!location) return state
  switch (event.type) {
    case "vcs.branch.updated":
      return withLocation(state, locationKey(location), (data) => ({
        ...data,
        vcs: { ...data?.vcs, branch: { ...data?.vcs?.branch, current: event.data.branch } },
      }))
    case "form.created":
      return withSession(state, "form", (all) => {
        const forms = all[event.data.form.sessionID] ?? []
        if (forms.some((form) => form.id === event.data.form.id)) return all
        const form = event.data.form.sessionID === "global" ? { ...event.data.form, location } : event.data.form
        return { ...all, [event.data.form.sessionID]: [...forms, form] }
      })
    case "shell.created":
      return withLocation(state, locationKey(location), (data) => ({
        ...data,
        shell: { ...data?.shell, [event.data.info.id]: { ...event.data.info, location } },
      }))
    case "shell.exited":
    case "shell.deleted":
      return withLocation(state, locationKey(location), (data) => ({
        ...data,
        shell: dropEntry(data?.shell ?? {}, event.data.id),
      }))
  }
  return state
}

function assistant(
  state: DataState,
  event: { data: { sessionID: string; assistantMessageID: string } },
  update: Parameters<typeof editAssistant>[2],
) {
  return editMessages(state, event.data.sessionID, (messages) =>
    editAssistant(messages, event.data.assistantMessageID, update),
  )
}

function tool(
  state: DataState,
  event: { data: { sessionID: string; assistantMessageID: string; id: string } },
  update: (part: SessionMessageAssistantTool) => SessionMessageAssistantTool,
) {
  return assistant(state, event, (item) => editLastContent(item, isTool(event.data.id), update))
}

function startStep(messages: SessionMessageInfo[], event: EventOf<"session.step.started">) {
  const position = messages.findLastIndex((item) => item.id === event.data.assistantMessageID)
  const existing = messages[position]
  if (existing?.type === "assistant")
    return messages.with(position, {
      ...existing,
      agent: event.data.agent,
      model: event.data.model,
      retry: undefined,
      error: undefined,
      finish: undefined,
      rawFinish: undefined,
      providerState: undefined,
      time: { created: event.data.started },
      snapshot: event.data.snapshot ? { ...existing.snapshot, start: event.data.snapshot } : existing.snapshot,
    })
  const closed = replaceMessage(messages, activeAssistantPosition(messages), (item) =>
    item.type === "assistant" ? { ...item, retry: undefined, time: { ...item.time, completed: event.created } } : item,
  )
  return appendMessage(closed, {
    id: event.data.assistantMessageID,
    type: "assistant",
    agent: event.data.agent,
    model: event.data.model,
    metadata: event.metadata,
    content: [],
    snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
    time: { created: event.data.started },
  })
}

function endExecution(
  state: DataState,
  event: EventOf<"session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted">,
) {
  const idle = setStatus(state, event.data.sessionID, "idle")
  const settled = editMessages(idle, event.data.sessionID, (messages) =>
    replaceMessage(messages, activeAssistantPosition(messages), (item) =>
      item.type === "assistant" && item.retry ? { ...item, retry: undefined } : item,
    ),
  )
  if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return settled
  // Mirror the projected idle marker so turn boundaries match before the next message read.
  return editMessages(settled, event.data.sessionID, (messages) =>
    appendMessage(messages, {
      id: messageIDFromEvent(event.id),
      type: "idle",
      outcome:
        event.type === "session.execution.succeeded"
          ? "succeeded"
          : event.type === "session.execution.failed"
            ? "failed"
            : "interrupted",
      time: { created: event.created },
    }),
  )
}

function moveSession(state: DataState, event: EventOf<"session.moved">) {
  const current = state.session.info[event.data.sessionID]
  if (!current) return state
  const previous = { location: { ...current.location }, projectID: current.projectID, subpath: current.subpath }
  const moved = editInfo(state, event.data.sessionID, (info) => ({
    ...info,
    location: event.data.location,
    projectID: event.data.projectID || info.projectID,
    subpath: event.data.subpath,
  }))
  return editMessages(moved, event.data.sessionID, (messages) =>
    appendMessage(messages, {
      id: messageIDFromEvent(event.id),
      type: "location-switched",
      location: event.data.location,
      projectID: event.data.projectID,
      subpath: event.data.subpath,
      previous,
      time: { created: event.created },
    }),
  )
}

// Sessions whose project directory is unknown are left for ./effects to re-read.
function adoptWorktree(state: DataState, event: EventOf<"worktree.resolved">) {
  return Object.values(state.session.info).reduce((current, info) => {
    const explicit = event.data.adopted?.includes(info.projectID)
    const directory = explicit ? current.project.info[info.projectID]?.canonical : info.location.directory
    if (!directory) return current
    const adopted = Worktree.adopt({ projectID: info.projectID, directory }, event.data)
    if (!adopted) return current
    return editInfo(current, info.id, (session) => ({
      ...session,
      projectID: adopted.projectID,
      subpath: adopted.subpath,
    }))
  }, state)
}

function deliverInbox(state: DataState, event: EventOf<"session.inbox.delivered">) {
  const admitted =
    state.session.pending[event.data.sessionID]?.some(
      (item) => item.id === event.data.inboxID && item.type !== "compaction",
    ) ?? false
  const removed = removePending(state, event.data.sessionID, event.data.inboxID)
  if (!admitted) return editMessages(removed, event.data.sessionID, (messages) => messages)
  return editMessages(removed, event.data.sessionID, (messages) => {
    const position = messages.findIndex((item) => item.id === event.data.inboxID)
    const existing = messages[position]
    if (!existing) return messages
    const delivered = { ...existing, time: { ...existing.time, created: event.created } } as SessionMessageInfo
    return [...messages.slice(0, position), ...messages.slice(position + 1), delivered]
  })
}

/** Upsert an admitted inbox item into pending and, for user and synthetic items, the transcript. */
export function admitInbox(state: DataState, item: NonNullable<DataState["session"]["pending"][string]>[number]) {
  const pending = withSession(state, "pending", (all) => {
    const items = all[item.sessionID] ?? []
    const position = items.findIndex((entry) => entry.id === item.id)
    return { ...all, [item.sessionID]: position < 0 ? [...items, item] : items.with(position, item) }
  })
  return materializeInbox(pending, item)
}

export function materializeInbox(state: DataState, item: NonNullable<DataState["session"]["pending"][string]>[number]) {
  if (item.type !== "user" && item.type !== "synthetic") return state
  const row: SessionMessageInfo =
    item.type === "user"
      ? { id: item.id, type: "user", ...item.payload, time: { created: item.time.created } }
      : { id: item.id, type: "synthetic", ...item.payload, time: { created: item.time.created } }
  return editMessages(state, item.sessionID, (messages) => upsertMessage(messages, row))
}

function retractInbox(state: DataState, sessionID: string, inboxID: string) {
  const removed = removePending(state, sessionID, inboxID)
  if (!removed.session.message[sessionID]?.some((item) => item.id === inboxID)) return removed
  return editMessages(removed, sessionID, (messages) => messages.filter((item) => item.id !== inboxID))
}

export function removePending(state: DataState, sessionID: string, inboxID: string) {
  return withSession(state, "pending", (all) => {
    const items = all[sessionID]
    if (!items?.some((item) => item.id === inboxID)) return all
    return { ...all, [sessionID]: items.filter((item) => item.id !== inboxID) }
  })
}

export function removePermission(state: DataState, sessionID: string, requestID: string) {
  return withSession(state, "permission", (all) => {
    const requests = all[sessionID]
    if (!requests?.some((request) => request.id === requestID)) return all
    return { ...all, [sessionID]: requests.filter((request) => request.id !== requestID) }
  })
}

export function removeForm(state: DataState, sessionID: string, formID: string, ref?: { directory: string }) {
  return withSession(state, "form", (all) => {
    const forms = all[sessionID]
    if (!forms) return all
    const location = ref && locationKey(ref)
    const next = forms.filter((form) => {
      if (form.id !== formID) return true
      if (sessionID !== "global" || !location) return false
      return !form.location || locationKey(form.location) !== location
    })
    return next.length === forms.length ? all : { ...all, [sessionID]: next }
  })
}

export function setStatus(state: DataState, sessionID: string, status: SessionStatus) {
  return withSession(state, "active", (all) => setEntry(all, sessionID, status))
}

export function removeSession(state: DataState, sessionID: string): DataState {
  const without = <Value>(record: Record<string, Value>) => dropEntry(record, sessionID)
  const family = Object.fromEntries(
    Object.entries(state.session.family).flatMap(([rootID, members]) => {
      const next = members.filter((id) => id !== sessionID)
      return next.length === 0 ? [] : [[rootID, next.length === members.length ? members : next]]
    }),
  )
  return {
    ...state,
    session: {
      info: without(state.session.info),
      family,
      active: without(state.session.active),
      message: without(state.session.message),
      messageCursor: without(state.session.messageCursor),
      messageLoading: without(state.session.messageLoading),
      pending: without(state.session.pending),
      permission: without(state.session.permission),
      form: without(state.session.form),
    },
  }
}

function commitRevert(state: DataState, event: EventOf<"session.revert.committed">) {
  const cleared = editInfo(state, event.data.sessionID, (info) => ({ ...info, revert: undefined }))
  // The projector also deletes inbox items enqueued at or after the boundary without a cancel event.
  const pending = withSession(cleared, "pending", (all) => ({
    ...all,
    [event.data.sessionID]: (all[event.data.sessionID] ?? []).filter((item) => item.id < event.data.to),
  }))
  return editMessages(pending, event.data.sessionID, (messages) => {
    const position = messages.findIndex((item) => item.id >= event.data.to)
    return position === -1 ? messages : messages.slice(0, position)
  })
}

const runningCompaction = (messages: SessionMessageInfo[]) =>
  messages.findLastIndex((item) => item.type === "compaction" && item.status === "running")

function endCompaction(messages: SessionMessageInfo[], event: EventOf<"session.compaction.ended">) {
  const completed = {
    type: "compaction" as const,
    status: "completed" as const,
    reason: event.data.reason,
    model: event.data.model,
    providerState: event.data.providerState,
    providerContext: event.data.providerContext,
    summary: event.data.text,
    recent: event.data.recent,
    cost: event.data.cost,
    tokens: event.data.tokens,
  }
  const position = runningCompaction(messages)
  const current = messages[position]
  if (current?.type === "compaction") return messages.with(position, { ...current, ...completed })
  return appendMessage(messages, { id: messageIDFromEvent(event.id), ...completed, time: { created: event.created } })
}

function failCompaction(messages: SessionMessageInfo[], event: EventOf<"session.compaction.failed">) {
  const position = runningCompaction(messages)
  const current = messages[position]
  const failed: Extract<SessionMessageInfo, { type: "compaction"; status: "failed" }> = {
    id: current?.id ?? event.data.inputID ?? messageIDFromEvent(event.id),
    type: "compaction",
    status: "failed",
    reason: event.data.reason ?? "manual",
    error: event.data.error ?? { type: "compaction.failed", message: "Compaction failed before recording an error" },
    metadata: current?.type === "compaction" ? current.metadata : event.metadata,
    cost: event.data.cost,
    tokens: event.data.tokens,
    time: current?.type === "compaction" ? current.time : { created: event.created },
  }
  if (current?.type === "compaction") return messages.with(position, failed)
  return appendMessage(messages, failed)
}
