// One server's data (#584): the framework-free replacement of the Solid client's createData.
// Events fold into an immutable snapshot (./reduce) and trigger revalidating reads (./effects);
// reads load through a de-duplicating gate (./sync-gate). Screens subscribe with selectors.

import type { OpenCodeClient, OpenCodeEvent, SessionInboxInfo } from "@opencode/client/promise"
import { batch, createStore, type Store } from "../store"
import type { ConnectionState } from "../connection"
import type { EventStream } from "../events"
import type { DataContext } from "./context"
import { runEffects } from "./effects"
import { createLocationReads } from "./location-reads"
import { reduceEvent } from "./reduce"
import { createAdmissions } from "./admissions"
import { createSessionReads, type Overlays } from "./session-reads"
import { emptyData, withSession, type DataState, type SessionStatus } from "./state"
import { createSyncGate } from "./sync-gate"

export const settleMs = 150

export type CreateDataInput = {
  readonly api: () => OpenCodeClient
  readonly directory: string
  readonly event: EventStream
  readonly connection?: Store<ConnectionState>
  /** Raw-message window of an initial transcript read. Older pages keep their normal size. */
  readonly initialMessageLimit?: () => number
  /** Receives failed event-driven reads. Explicit reads still reject to their caller. */
  readonly onError?: (error: unknown) => void
}

export function createData(input: CreateDataInput) {
  const store = createStore(emptyData(input.directory))
  const gate = createSyncGate()
  const disposed = { value: false }
  const connected = () => !input.connection || input.connection.get().status === "connected"
  const settling = new Map<string, ReturnType<typeof setTimeout>>()

  const refresh = (load: () => Promise<unknown>) => {
    if (disposed.value || !connected()) return
    void load().catch((error) => {
      if (disposed.value || !connected()) return
      if (input.onError) return input.onError(error)
      console.error("Failed to refresh client data", error)
    })
  }
  const context: DataContext = {
    api: input.api,
    store,
    gate,
    refresh,
    settle(key, load) {
      clearTimeout(settling.get(key))
      settling.set(
        key,
        setTimeout(() => {
          settling.delete(key)
          refresh(load)
        }, settleMs),
      )
    },
    initialMessageLimit: input.initialMessageLimit ?? (() => 20),
  }

  const overlays: Overlays = { pending: new Map(), outbox: { inbox: new Set(), sessions: new Set() } }
  // Lifecycle events received while the running-session snapshot loads supersede it.
  const activeOverlay: { current?: Map<string, SessionStatus | undefined> } = {}

  const project = {
    list: () => projectList(store.get().project.info),
    get: (projectID: string) => store.get().project.info[projectID],
    sync: () =>
      gate.run("project", async () => {
        const projects = await input.api().project.list()
        store.set((state) => ({
          ...state,
          project: { ...state.project, info: Object.fromEntries(projects.map((item) => [item.id, item])) },
        }))
      }),
    invalidate: () => gate.invalidate("project"),
    permission: {
      list: (projectID: string) => store.get().project.permission[projectID],
      sync: (projectID: string) =>
        gate.run(`project.permission:${projectID}`, async () => {
          const saved = await input.api().permission.saved.list({ projectID })
          store.set((state) => ({
            ...state,
            project: { ...state.project, permission: { ...state.project.permission, [projectID]: saved } },
          }))
        }),
      invalidate: (projectID: string) => gate.invalidate(`project.permission:${projectID}`),
    },
  }

  // Buff (#467): a project registered after the list loaded (a directory added in this window) is
  // not announced by its own event. Meeting an unknown project re-reads the list, once per project.
  const sought = new Set<string>()
  const discoverProject = (projectID: string | undefined) => {
    if (!projectID || store.get().project.info[projectID] || sought.has(projectID)) return
    sought.add(projectID)
    project.invalidate()
    refresh(() => project.sync())
  }

  const session = { ...createSessionReads(context, overlays), ...createAdmissions(context, overlays.outbox) }
  const locationReads = createLocationReads(context, discoverProject)
  const location = {
    ...locationReads,
    async sync(ref?: Parameters<typeof locationReads.sync>[0]) {
      await Promise.all([locationReads.sync(ref), session.form.sync("global", ref)])
    },
  }

  const hydrateActive = () => {
    const updates = new Map<string, SessionStatus | undefined>()
    activeOverlay.current = updates
    refresh(() =>
      input
        .api()
        .session.active()
        .then((active) => {
          if (activeOverlay.current !== updates) return
          const snapshot = new Map<string, SessionStatus>(Object.keys(active).map((id) => [id, "running"]))
          updates.forEach((status, id) => (status === undefined ? snapshot.delete(id) : snapshot.set(id, status)))
          activeOverlay.current = undefined
          store.set((state) => withSession(state, "active", () => Object.fromEntries(snapshot)))
        })
        .catch(() => {
          if (activeOverlay.current === updates) activeOverlay.current = undefined
        }),
    )
  }

  const handle = (event: OpenCodeEvent) => {
    recordOverlays(event, overlays, activeOverlay.current, store.get())
    batch(() => {
      store.set((state) => reduceEvent(state, event))
      runEffects(context, { session, location, project, discoverProject, hydrateActive }, event)
    })
  }

  const stopEvents = input.event.listen(handle)
  // A dropped connection may have missed events, so every cached read is stale until reconnected.
  const stopConnection = input.connection?.subscribe(() => {
    if (!connected()) gate.invalidate()
  })

  return {
    state: store,
    session,
    project,
    location,
    shell: {
      list: (ref?: Parameters<typeof location.shell.list>[0]) => Object.values(location.shell.list(ref) ?? {}),
      sync: location.shell.sync,
      invalidate: location.shell.invalidate,
    },
    dispose() {
      disposed.value = true
      stopEvents()
      stopConnection?.()
      settling.forEach((timer) => clearTimeout(timer))
    },
  }
}

export type Data = ReturnType<typeof createData>

function projectList(info: DataState["project"]["info"]) {
  return Object.values(info).toSorted((a, b) => b.time.updated - a.time.updated)
}

// Inbox and lifecycle events that overtake an in-flight pending or status snapshot.
function recordOverlays(
  event: OpenCodeEvent,
  overlays: Overlays,
  active: Map<string, SessionStatus | undefined> | undefined,
  state: DataState,
) {
  const pending = (sessionID: string) => overlays.pending.get(sessionID)
  switch (event.type) {
    case "session.created":
      overlays.outbox.sessions.delete(event.data.sessionID)
      return
    case "session.execution.started":
      active?.set(event.data.sessionID, "running")
      return
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
      active?.set(event.data.sessionID, "idle")
      return
    case "session.deleted":
      active?.set(event.data.sessionID, undefined)
      return
    case "session.inbox.enqueued": {
      overlays.outbox.inbox.delete(event.data.inboxID)
      const item = {
        id: event.data.inboxID,
        sessionID: event.data.sessionID,
        time: { created: event.created },
        ...event.data.item,
      } as SessionInboxInfo
      pending(event.data.sessionID)?.set(item.id, item)
      return
    }
    case "session.inbox.delivered":
    case "session.inbox.cancelled":
      pending(event.data.sessionID)?.set(event.data.inboxID, undefined)
      return
    case "session.inbox.delivery.changed": {
      const item = state.session.pending[event.data.sessionID]?.find((entry) => entry.id === event.data.inboxID)
      pending(event.data.sessionID)?.set(
        event.data.inboxID,
        item ? { ...item, delivery: event.data.delivery } : event.data.delivery,
      )
      return
    }
    case "session.compaction.started":
    case "session.compaction.failed":
      if (event.data.inputID) pending(event.data.sessionID)?.set(event.data.inputID, undefined)
      return
  }
}
