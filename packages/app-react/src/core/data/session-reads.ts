// Session reads (#584), ported from the Solid data layer's session API: info, families,
// transcripts with paging, pending inbox, permissions and forms. Optimistic admissions (create,
// prompt, compact) arrive with the composer.

import {
  isFormAlreadySettledError,
  isFormNotFoundError,
  isPermissionNotFoundError,
  type LocationRef,
  type PermissionReplyInput,
  type SessionFormCancelInput,
  type SessionFormReplyInput,
  type SessionInboxInfo,
  type SessionInfo,
  type SessionMessageInfo,
} from "@opencode/client/promise"
import { batch } from "../store"
import { defaultLocation, locationQuery, type DataContext } from "./context"
import { registerSession, resolveRoot } from "./family"
import { materializeInbox, removeForm, removePermission } from "./reduce"
import { dropEntry, locationKey, setEntry, withSession, type DataState, type SessionStatus } from "./state"

const messagePageLimit = 20

/** Inbox and lifecycle events that land while a pending or status snapshot is in flight. */
export type Overlays = {
  pending: Map<string, Map<string, SessionInboxInfo | SessionInboxInfo["delivery"] | undefined>>
  /** Optimistic admissions the server has not acknowledged yet (see admissions.ts). */
  outbox: { inbox: Set<string>; sessions: Set<string> }
}

export function createSessionReads(context: DataContext, overlays: Overlays) {
  const api = context.api
  const state = () => context.store.get()
  const set = (update: (state: DataState) => DataState) => context.store.set(update)
  const messageLoads = new Map<string, Promise<unknown>>()

  function publishSessions(sessions: SessionInfo[]) {
    batch(() => {
      set((current) =>
        withSession(current, "info", (info) => ({ ...info, ...Object.fromEntries(sessions.map((s) => [s.id, s])) })),
      )
      sessions.forEach((session) => {
        context.gate.complete(`session:${session.id}`)
        set((current) => registerSession(current, session.id))
      })
    })
  }

  function evictOne(sessionID: string) {
    context.gate.invalidate(`session.pending:${sessionID}`)
    context.gate.invalidate(`session.message:${sessionID}`)
    messageLoads.delete(sessionID)
    set((current) => ({
      ...current,
      session: {
        ...current.session,
        message: dropEntry(current.session.message, sessionID),
        messageCursor: dropEntry(current.session.messageCursor, sessionID),
        messageLoading: dropEntry(current.session.messageLoading, sessionID),
        pending: dropEntry(current.session.pending, sessionID),
      },
    }))
  }

  const message = {
    list: (sessionID: string) => state().session.message[sessionID] ?? [],
    get: (sessionID: string, messageID: string) =>
      state().session.message[sessionID]?.find((item) => item.id === messageID),
    sync(sessionID: string) {
      return context.gate.run(`session.message:${sessionID}`, async () => {
        const before = new Set(state().session.message[sessionID] ?? [])
        const response = await api().message.list({
          sessionID,
          limit: context.initialMessageLimit(),
          order: "desc",
        })
        // Events that landed while the read was in flight (a reconnect's live stream racing its
        // re-read) are newer than what the server answered with: their messages win.
        const live = new Map(
          (state().session.message[sessionID] ?? []).filter((item) => !before.has(item)).map((item) => [item.id, item]),
        )
        const fetched = response.data.toReversed().map((item) => live.get(item.id) ?? item)
        // A re-fetch racing an admission must not wipe its local transcript row.
        const ids = new Set(fetched.map((item) => item.id))
        const admitted = new Set(
          (state().session.pending[sessionID] ?? []).flatMap((item) =>
            item.type === "user" || item.type === "synthetic" ? [item.id] : [],
          ),
        )
        const local = (state().session.message[sessionID] ?? []).filter(
          (item) =>
            !ids.has(item.id) && (overlays.outbox.inbox.has(item.id) || admitted.has(item.id) || live.has(item.id)),
        )
        const messages = local.length === 0 ? fetched : [...fetched, ...local]
        set((current) => ({
          ...current,
          session: {
            ...current.session,
            message: { ...current.session.message, [sessionID]: messages },
            messageCursor: { ...current.session.messageCursor, [sessionID]: response.cursor.next ?? undefined },
          },
        }))
      })
    },
    more: (sessionID: string) => state().session.messageCursor[sessionID] !== undefined,
    loading: (sessionID: string) => state().session.messageLoading[sessionID] ?? false,
    async loadMore(sessionID: string, options?: { all?: boolean; signal?: AbortSignal }) {
      const signal = options?.signal
      if (signal?.aborted) return
      while (messageLoads.has(sessionID)) {
        const published = await waitFor(messageLoads.get(sessionID), signal)
        if ((!options?.all && published) || signal?.aborted) return
      }
      const cursor = state().session.messageCursor[sessionID]
      if (!cursor || signal?.aborted) return
      set((current) => withSession(current, "messageLoading", (all) => setEntry(all, sessionID, true)))
      const request = loadPages(sessionID, cursor, options)
        .catch((error) => {
          if (!signal?.aborted) throw error
        })
        .finally(() =>
          set((current) => withSession(current, "messageLoading", (all) => setEntry(all, sessionID, false))),
        )
      track(messageLoads, sessionID, request)
      await request
    },
    invalidate: (sessionID: string) => context.gate.invalidate(`session.message:${sessionID}`),
  }

  async function loadPages(sessionID: string, cursor: string, options?: { all?: boolean; signal?: AbortSignal }) {
    const fetched: SessionMessageInfo[] = []
    let next: string | undefined = cursor
    do {
      const response = await api().message.list(
        { sessionID, limit: options?.all ? 200 : messagePageLimit, cursor: next },
        { signal: options?.signal },
      )
      if (options?.signal?.aborted) return
      fetched.push(...response.data)
      next = response.cursor.next ?? undefined
    } while (options?.all && next)
    // A jump through history publishes once, not once per page of offscreen messages.
    const existing = state().session.message[sessionID] ?? []
    const ids = new Set(existing.map((item) => item.id))
    const messages = [...fetched.toReversed().filter((item) => !ids.has(item.id)), ...existing]
    set((current) => ({
      ...current,
      session: {
        ...current.session,
        message: { ...current.session.message, [sessionID]: messages },
        messageCursor: { ...current.session.messageCursor, [sessionID]: next },
      },
    }))
    return true
  }

  const pending = {
    list: (sessionID: string) => state().session.pending[sessionID] ?? [],
    sync(sessionID: string) {
      return context.gate.run(`session.pending:${sessionID}`, async () => {
        const updates = new Map<string, SessionInboxInfo | SessionInboxInfo["delivery"] | undefined>()
        overlays.pending.set(sessionID, updates)
        const snapshot = await api()
          .session.inbox.list({ sessionID })
          .finally(() => {
            if (overlays.pending.get(sessionID) === updates) overlays.pending.delete(sessionID)
          })
        // Events can overtake this HTTP response on a remote connection. Reconcile them before an
        // older snapshot can resurrect delivered input.
        const current = new Map(snapshot.map((item) => [item.id, item]))
        updates.forEach((item, id) => {
          if (item === undefined) return current.delete(id)
          if (typeof item !== "string") return current.set(id, item)
          const existing = current.get(id)
          if (existing) current.set(id, { ...existing, delivery: item })
        })
        // A positive read acknowledges admission even when its echo is delayed; rows still awaiting
        // their echo stay, since this read may have overtaken an admission the server lacks.
        snapshot.forEach((item) => overlays.outbox.inbox.delete(item.id))
        const inflight = (state().session.pending[sessionID] ?? []).filter(
          (item) => overlays.outbox.inbox.has(item.id) && !current.has(item.id),
        )
        const items = [...current.values(), ...inflight]
        set((next) =>
          items.reduce(
            materializeInbox,
            withSession(next, "pending", (all) => ({ ...all, [sessionID]: items })),
          ),
        )
      })
    },
    invalidate: (sessionID: string) => context.gate.invalidate(`session.pending:${sessionID}`),
  }

  const permission = {
    list: (sessionID: string) => state().session.permission[sessionID],
    sync(sessionID: string) {
      return context.gate.run(`session.permission:${sessionID}`, async () => {
        const requests = await api().permission.list({ sessionID })
        set((current) => withSession(current, "permission", (all) => ({ ...all, [sessionID]: requests })))
      })
    },
    invalidate: (sessionID: string) => context.gate.invalidate(`session.permission:${sessionID}`),
    async reply(input: PermissionReplyInput) {
      await api()
        .permission.reply(input)
        .catch((error: unknown) => {
          if (!isPermissionNotFoundError(error)) throw error
        })
      set((current) => removePermission(current, input.sessionID, input.requestID))
    },
  }

  const formKey = (sessionID: string, ref?: LocationRef) =>
    `session.form:${sessionID}:${sessionID === "global" ? locationKey(ref ?? defaultLocation(context)) : ""}`
  const form = {
    list(sessionID: string, ref?: LocationRef) {
      const forms = state().session.form[sessionID]
      if (sessionID !== "global") return forms
      if (!ref) return
      const key = locationKey(ref)
      return forms?.filter((item) => item.location && locationKey(item.location) === key)
    },
    sync(sessionID: string, ref?: LocationRef) {
      return context.gate.run(formKey(sessionID, ref), async () => {
        if (sessionID !== "global") {
          const forms = await api().session.form.list({ sessionID })
          return set((current) => withSession(current, "form", (all) => ({ ...all, [sessionID]: forms })))
        }
        const response = await api().form.list({ location: locationQuery(ref ?? defaultLocation(context)) })
        const location = { directory: response.location.directory }
        const id = locationKey(location)
        set((current) =>
          withSession(current, "form", (all) => ({
            ...all,
            global: [
              ...(all.global ?? []).filter((item) => item.location && locationKey(item.location) !== id),
              ...response.data.filter((item) => item.sessionID === "global").map((item) => ({ ...item, location })),
            ],
          })),
        )
      })
    },
    invalidate: (sessionID: string, ref?: LocationRef) => context.gate.invalidate(formKey(sessionID, ref)),
    reply: (input: SessionFormReplyInput, ref?: LocationRef) =>
      settleForm(input, ref, api().session.form.reply(input, formRequestOptions(input.sessionID, ref))),
    cancel: (input: SessionFormCancelInput, ref?: LocationRef) =>
      settleForm(input, ref, api().session.form.cancel(input, formRequestOptions(input.sessionID, ref))),
  }

  function settleForm(input: SessionFormCancelInput, ref: LocationRef | undefined, request: Promise<void>) {
    return request
      .catch((error: unknown) => {
        if ((!isFormNotFoundError(error) && !isFormAlreadySettledError(error)) || error.id !== input.formID) throw error
      })
      .then(() => {
        const before = state()
        set((current) => removeForm(current, input.sessionID, input.formID, ref))
        if (state() === before) return
        form.invalidate(input.sessionID, ref)
        void form.sync(input.sessionID, ref).catch(() => undefined)
      })
  }

  return {
    get: (sessionID: string) => state().session.info[sessionID],
    remember(info: SessionInfo) {
      publishSessions([info])
    },
    setStatus(sessionID: string, status: SessionStatus) {
      set((current) => withSession(current, "active", (all) => setEntry(all, sessionID, status)))
    },
    root: (sessionID: string) => resolveRoot(state(), sessionID),
    family: (sessionID: string) => state().session.family[resolveRoot(state(), sessionID)] ?? [],
    /** Clear heavy cached data for the root and all known descendants. */
    evict(sessionID: string) {
      const root = resolveRoot(state(), sessionID)
      batch(() => new Set([root, sessionID, ...(state().session.family[root] ?? [])]).forEach(evictOne))
    },
    cost(sessionID: string) {
      const session = state().session.info[sessionID]
      if (!session) return 0
      if (session.parentID) return session.cost
      return (state().session.family[sessionID] ?? [sessionID]).reduce(
        (total, id) => total + (state().session.info[id]?.cost ?? 0),
        0,
      )
    },
    status: (sessionID: string) => state().session.active[sessionID] ?? "idle",
    // Inputs are the pending user and synthetic items; compactions are control items.
    input: {
      list: (sessionID: string) =>
        (state().session.pending[sessionID] ?? []).flatMap((item) => (item.type === "compaction" ? [] : [item.id])),
      has: (sessionID: string, inboxID: string) =>
        state().session.pending[sessionID]?.some((item) => item.id === inboxID && item.type !== "compaction") ?? false,
    },
    pending,
    sync(sessionID: string, options?: { children?: boolean }) {
      return context.gate.run(options?.children ? `session.family:${sessionID}` : `session:${sessionID}`, async () => {
        const [info, children] = await Promise.all([
          api().session.get({ sessionID }),
          options?.children
            ? api()
                .session.list({ parentID: sessionID, order: "desc" })
                .then((response) => response.data)
            : [],
        ])
        publishSessions([info, ...children])
      })
    },
    invalidate: (sessionID: string) => context.gate.invalidate(`session:${sessionID}`),
    message,
    permission,
    form,
  }
}

export type SessionReads = ReturnType<typeof createSessionReads>

// Register `promise` under `key` until it settles; settlement only clears its own entry.
function track(map: Map<string, Promise<unknown>>, key: string, promise: Promise<unknown>) {
  map.set(key, promise)
  const settle = () => {
    if (map.get(key) === promise) map.delete(key)
  }
  void promise.then(settle, settle)
}

function waitFor(pending: Promise<unknown> | undefined, signal?: AbortSignal) {
  if (!signal) return pending
  const aborted = Promise.withResolvers<void>()
  const cancel = () => aborted.resolve()
  signal.addEventListener("abort", cancel, { once: true })
  return Promise.race([pending, aborted.promise])
    .catch((error) => {
      if (!signal.aborted) throw error
    })
    .finally(() => signal.removeEventListener("abort", cancel))
}

// Global MCP elicitations need the directory header, since the server cannot recover their Location.
function formRequestOptions(sessionID: string, ref?: LocationRef) {
  if (sessionID !== "global" || !ref) return undefined
  return { headers: { "x-opencode-directory": encodeURIComponent(ref.directory) } }
}
