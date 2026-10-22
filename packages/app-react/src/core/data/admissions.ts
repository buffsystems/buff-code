// Optimistic admissions (#584), ported from the Solid data layer: a prompt shows in the transcript
// under a client-minted id the moment it is sent, a new session exists locally before the server
// confirms it, and both roll back only what the server never acknowledged. Prompts of one session
// are admitted in submission order, and wait for that session's in-flight create.

import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import type {
  LocationRef,
  ModelRef,
  PermissionRuleset,
  SessionInboxInfo,
  SessionInfo,
} from "@opencode/client/promise"
import type { OpenCodeClient } from "@opencode/client/promise"
import { batch } from "../store"
import { defaultLocation, type DataContext } from "./context"
import { registerSession } from "./family"
import { admitInbox, removePending, removeSession, setStatus } from "./reduce"
import { editMessages, locationKey, withSession, type SessionStatus } from "./state"

type PromptRequest = Parameters<OpenCodeClient["session"]["prompt"]>[0]

/** Ids awaiting the server's acknowledgement; reads keep these rows instead of wiping them. */
export type Outbox = { inbox: Set<string>; sessions: Set<string> }

export function createAdmissions(context: DataContext, outbox: Outbox) {
  const api = context.api
  const set = context.store.set
  const creating = new Map<string, Promise<unknown>>()
  const sending = new Map<string, Promise<unknown>>()
  // First prompts shown before their session exists (a worktree is made first); not sent yet.
  const staged = new Set<string>()

  const send = <Value>(sessionID: string, run: () => Promise<Value>, gate?: Promise<unknown>) => {
    const created = creating.get(sessionID)
    const previous = sending.get(sessionID)
    const request = Promise.resolve()
      .then(() => Promise.all([gate, created, previous]))
      .then(run)
    track(sending, sessionID, request.catch(() => undefined))
    return request
  }

  const retract = (sessionID: string, inboxID: string) =>
    set((state) => {
      const removed = removePending(state, sessionID, inboxID)
      return editMessages(removed, sessionID, (messages) =>
        messages.some((item) => item.id === inboxID) ? messages.filter((item) => item.id !== inboxID) : messages,
      )
    })

  const remember = (info: SessionInfo) =>
    batch(() => {
      set((state) => withSession(state, "info", (all) => ({ ...all, [info.id]: info })))
      context.gate.complete(`session:${info.id}`)
      set((state) => registerSession(state, info.id))
    })

  return {
    creating: (sessionID: string) => creating.has(sessionID),
    setStatus: (sessionID: string, status: SessionStatus) => set((state) => setStatus(state, sessionID, status)),
    /** Admit a prompt locally, send it, and roll it back if the server never took it. */
    prompt(input: PromptRequest & { gate?: Promise<unknown> }) {
      const { gate, ...request } = input
      const id = request.id ?? SessionMessage.ID.create()
      const state = context.store.get()
      // A staged prompt is already shown: it is sent now, and leaves if the server refuses it.
      const shown = staged.delete(id)
      // A retry may reuse an id that is already rendered or durable: admit only new ids.
      const fresh =
        shown ||
        (!state.session.message[request.sessionID]?.some((item) => item.id === id) &&
          !state.session.pending[request.sessionID]?.some((item) => item.id === id))
      if (fresh && !shown) {
        outbox.inbox.add(id)
        set((current) => admitInbox(current, inboxItem(request.sessionID, id, request)))
      }
      return send(request.sessionID, () => api().session.prompt({ ...request, id }), gate).catch((error: unknown) => {
        if (fresh && outbox.inbox.delete(id)) retract(request.sessionID, id)
        throw error
      })
    },
    /**
     * Show a first prompt before its session exists (#584: a new worktree is created first): the
     * transcript reads it without asking the server, and `prompt` with the same id sends it.
     */
    stage(input: { sessionID: string; id: string; text: string; metadata?: PromptRequest["metadata"] }) {
      staged.add(input.id)
      outbox.inbox.add(input.id)
      context.gate.complete(`session.family:${input.sessionID}`)
      context.gate.complete(`session.pending:${input.sessionID}`)
      context.gate.complete(`session.message:${input.sessionID}`)
      set((current) => admitInbox(current, inboxItem(input.sessionID, input.id, input)))
    },
    /** A staged prompt whose session was never made leaves the transcript. */
    unstage(sessionID: string, id: string) {
      if (!staged.delete(id)) return
      outbox.inbox.delete(id)
      retract(sessionID, id)
    },
    /** Create a session under a client-minted id; it shows at once and the echo replaces it. */
    create(input: {
      id?: string
      title?: string
      agent?: string
      model?: ModelRef
      location?: LocationRef
      projectID?: string
      permissions?: PermissionRuleset
    }) {
      const { projectID, ...payload } = input
      const id = payload.id ?? SessionID.create()
      const location = payload.location ?? defaultLocation(context)
      const state = context.store.get()
      const fresh = !state.session.info[id]
      if (fresh) {
        const now = Date.now()
        outbox.sessions.add(id)
        remember({
          id,
          projectID: projectID ?? state.location[locationKey(location)]?.info?.project.id ?? "",
          agent: payload.agent,
          model: payload.model,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: now, updated: now },
          title: payload.title,
          location,
        } as SessionInfo)
        // A mounted optimistic session must not read its empty collections before creation settles.
        context.gate.complete(`session.family:${id}`)
        context.gate.complete(`session.pending:${id}`)
        context.gate.complete(`session.message:${id}`)
      }
      const request = Promise.resolve()
        .then(() => api().session.create({ ...payload, id, location }))
        .then((info) => {
          outbox.sessions.delete(id)
          remember(info)
          return info
        })
        .catch((error: unknown) => {
          if (fresh && outbox.sessions.delete(id)) set((current) => removeSession(current, id))
          throw error
        })
      if (fresh) track(creating, id, request)
      return { id, request }
    },
  }
}

function inboxItem(
  sessionID: string,
  id: string,
  request: { text: string; agents?: PromptRequest["agents"]; metadata?: PromptRequest["metadata"]; delivery?: PromptRequest["delivery"] },
) {
  return {
    id,
    sessionID,
    time: { created: Date.now() },
    type: "user",
    delivery: request.delivery ?? "steer",
    // Files and skills fill in when the durable echo replaces the row.
    payload: { text: request.text, agents: request.agents?.map((agent) => ({ ...agent })), metadata: request.metadata },
  } as SessionInboxInfo
}

export type Admissions = ReturnType<typeof createAdmissions>

function track(map: Map<string, Promise<unknown>>, key: string, promise: Promise<unknown>) {
  map.set(key, promise)
  const settle = () => {
    if (map.get(key) === promise) map.delete(key)
  }
  void promise.then(settle, settle)
}
