// The composer's agent / model / variant pick as React reads it (#584): the location's catalogs
// from the core data, the window's model preferences, and the pick kept per session (persisted
// per workspace) or per draft (in memory until its session exists).

import { useEffect, useMemo, useRef } from "react"
import { resolveSessionComposerSelection } from "@opencode/app/react-reuse/session-composer-selection"
import { createStore, type Store } from "../../../core/store"
import type { Server } from "../../../core/servers"
import { locationKey } from "../../../core/data/state"
import { useCore, useServerData } from "../../../react/core"
import { useStore } from "../../../react/use-store"
import { createPersistedDocument } from "../draft/document"
import { workspaceTarget } from "../draft/target"
import { useSettings } from "../../../shell/settings-context"
import { normalizeAgentList, normalizeProviderList, type ModelKey } from "../../../providers/models/catalog"
import { modelPreferences } from "../../../providers/models/preferences"
import {
  ModelSelectionSchema,
  chooseAgent,
  chooseModel,
  chooseVariant,
  cycleAgent,
  nextVariant,
  resolveSelection,
  sameSelection,
  type Selection,
  type SelectionState,
} from "./selection"
import type { ComposerSelection } from "../submit/submit"

type SavedDocument = ReturnType<typeof createSavedDocument>

function createSavedDocument(storage: Parameters<typeof modelPreferences>[0], scope: string, directory: string) {
  return createPersistedDocument({
    host: { storage },
    target: workspaceTarget(scope, directory, "workspace:model-selection"),
    schema: ModelSelectionSchema,
    initial: { session: {} },
  })
}

const savedDocuments = new WeakMap<object, Map<string, SavedDocument>>()
function savedDocument(storage: Parameters<typeof modelPreferences>[0], scope: string, directory: string) {
  const documents = savedDocuments.get(storage) ?? new Map<string, SavedDocument>()
  savedDocuments.set(storage, documents)
  const key = JSON.stringify([scope, directory])
  const existing = documents.get(key)
  if (existing) return existing
  const created = createSavedDocument(storage, scope, directory)
  documents.set(key, created)
  return created
}

// A draft's pick, and the pick a new session inherits from its draft until the workspace's saved
// document holds it (the Solid window's handoff).
const draftPicks = new Map<string, Store<SelectionState | undefined>>()
const handoff = new Map<string, SelectionState>()
function draftPick(draftID: string) {
  const existing = draftPicks.get(draftID)
  if (existing) return existing
  const created = createStore<SelectionState | undefined>(undefined)
  draftPicks.set(draftID, created)
  return created
}

const none = createStore<SelectionState | undefined>(undefined)

export type ModelSelectionHandle = {
  selection: Selection
  setModel(item: ModelKey | undefined, options?: { recent?: boolean }): void
  setVariant(value: string | undefined): void
  cycleVariant(): void
  setAgent(name: string): void
  cycleAgent(direction: 1 | -1): void
  current(): ComposerSelection | undefined
  track(sessionID: string, value: ComposerSelection): () => void
  promote(directory: string, sessionID: string): void
}

export function useModelSelection(input: {
  server: Server
  directory: string
  sessionID?: string
  draftID?: string
}): ModelSelectionHandle {
  const core = useCore()
  const storage = core.platform.storage
  const scope = core.scope(input.server.key)
  const prefs = modelPreferences(storage)
  const saved = savedDocument(storage, scope, input.directory)
  const draft = input.draftID ? draftPick(input.draftID) : none
  const ref = useMemo(() => ({ directory: input.directory }), [input.directory])
  const key = locationKey(ref)
  const handoffKey = input.sessionID ? JSON.stringify([scope, input.directory, input.sessionID]) : undefined

  // A session's catalogs are read with its location (session/location.ts: retried, and again after a
  // reconnect); a draft reads its own.
  const reads = input.sessionID ? "session" : "draft"
  useEffect(() => {
    const data = input.server.data
    const quiet = () => undefined
    void data.location.config.sync(ref).catch(quiet)
    if (reads === "session") return
    void data.location.agent.sync(ref).catch(quiet)
    void data.location.provider.sync(ref).catch(quiet)
    void data.location.model.sync(ref).catch(quiet)
  }, [input.server, ref, reads])

  const location = useServerData(input.server, (state) => state.location[key])
  const session = useServerData(input.server, (state) =>
    input.sessionID ? state.session.info[input.sessionID] : undefined,
  )
  // #562: the model of the last session on the server, as one key so the memo sees a change.
  const lastSessionKey = useServerData(input.server, (state) => {
    const last = Object.values(state.session.info)
      .filter((item) => item?.model)
      .toSorted((a, b) => (b?.time.updated ?? 0) - (a?.time.updated ?? 0))[0]?.model
    return last ? `${last.providerID}\u0000${last.id}` : undefined
  })
  const lastSession = useMemo(() => {
    if (!lastSessionKey) return undefined
    const [providerID = "", modelID = ""] = lastSessionKey.split("\u0000")
    return { providerID, modelID }
  }, [lastSessionKey])
  const savedPick = useStore(saved.store, (state) => (input.sessionID ? state.session[input.sessionID] : undefined))
  const draftState = useStore(draft, (state) => state)
  const prefsState = useStore(prefs.store, (state) => state)
  const showCustomAgents = useSettings((state) => state.general.showCustomAgents)
  const prefsLoaded = useStore(prefs.loaded, (loaded) => loaded)

  const pick = input.sessionID ? (savedPick ?? (handoffKey ? handoff.get(handoffKey) : undefined)) : draftState
  const selection = useMemo(
    () =>
      resolveSelection({
        scope: pick,
        session: session && { agent: session.agent, model: session.model },
        agents: normalizeAgentList(location?.agent ?? []),
        agentsLoaded: location?.agent !== undefined,
        catalog: normalizeProviderList(location?.provider, location?.model),
        catalogLoaded: location?.provider !== undefined && location?.model !== undefined,
        config: location?.config,
        prefs,
        showCustomAgents,
        lastSession,
      }),
    // prefsState keys the memo on preference changes; prefs reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pick, session?.agent, session?.model, location, prefsState, prefsLoaded, showCustomAgents, prefs, lastSession],
  )

  // A session without its own model yet takes the pick of its last prompt (the Solid window's
  // syncSessionModel / local.session.restore).
  const lastPrompt = useServerData(input.server, (state) =>
    input.sessionID ? state.session.message[input.sessionID]?.findLast((message) => message.type === "user") : undefined,
  )
  const savedLoaded = useStore(saved.loaded, (loaded) => loaded)
  useEffect(() => {
    const sessionID = input.sessionID
    if (!sessionID || session?.model || !savedLoaded || saved.store.get().session[sessionID] !== undefined) return
    if (handoffKey && handoff.has(handoffKey)) return
    const restored = resolveSessionComposerSelection(session, lastPrompt?.metadata)
    if (!restored.agent || !restored.model) return
    saved.set((state) => ({
      ...state,
      session: {
        ...state.session,
        [sessionID]: { agent: restored.agent, model: restored.model, variant: restored.model?.variant ?? null },
      },
    }))
    // The last prompt and the session's own model decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPrompt, session?.model, input.sessionID, savedLoaded])

  const latest = useRef({ selection, pick })
  latest.current = { selection, pick }

  // Once the server's session carries the pick a send applied, the local pick is dropped.
  const pending = useRef(new Map<string, SelectionState>())
  useEffect(() => {
    const reconcile = (sessionID: string) => {
      const expected = pending.current.get(sessionID)
      const info = input.server.data.state.get().session.info[sessionID]
      if (!expected || !info?.model) return
      const confirmed = sameSelection(expected, {
        agent: info.agent,
        model: { providerID: info.model.providerID, modelID: info.model.id },
        variant: info.model.variant,
      })
      if (!confirmed) return
      pending.current.delete(sessionID)
      const stored = saved.store.get().session[sessionID]
      if (!stored || !sameSelection(stored, expected)) return
      saved.set((state) => ({ ...state, session: { ...state.session, [sessionID]: undefined } }))
    }
    const stops = [
      input.server.event.on("session.model.selected", (event) => queueMicrotask(() => reconcile(event.data.sessionID))),
      input.server.event.on("session.agent.selected", (event) => queueMicrotask(() => reconcile(event.data.sessionID))),
      input.server.event.on("session.deleted", (event) => {
        pending.current.delete(event.data.sessionID)
        saved.set((state) => ({ ...state, session: { ...state.session, [event.data.sessionID]: undefined } }))
      }),
    ]
    return () => stops.forEach((stop) => stop())
  }, [input.server, saved])

  const write = (next: SelectionState | undefined) => {
    if (!input.sessionID) return draft.set(() => next)
    const sessionID = input.sessionID
    saved.set((state) => ({ ...state, session: { ...state.session, [sessionID]: next } }))
  }

  const actions: Omit<ModelSelectionHandle, "selection"> = useMemo(
    () => ({
      setModel(item: ModelKey | undefined, options?: { recent?: boolean }) {
        const { selection, pick } = latest.current
        if (item && !selection.valid(item)) return
        write(chooseModel(selection, pick, item))
        if (!item) return
        prefs.setVisibility(item, true)
        if (options?.recent) prefs.pushRecent(item)
      },
      setVariant(value: string | undefined) {
        const { selection, pick } = latest.current
        const model = selection.model
        if (!model) return
        write(chooseVariant(selection, pick, value))
        prefs.setVariant({ providerID: model.provider.id, modelID: model.id }, value)
      },
      cycleVariant() {
        const { selection } = latest.current
        if (selection.variants.length === 0) return
        actions.setVariant(nextVariant(selection))
      },
      setAgent(name: string) {
        const { selection, pick } = latest.current
        const next = chooseAgent(selection, pick, name)
        if (next !== pick) write(next)
      },
      cycleAgent(direction: 1 | -1) {
        const name = cycleAgent(latest.current.selection, direction)
        if (name) actions.setAgent(name)
      },
      /** What a send applies now, or undefined when no agent or model is available. */
      current(): ComposerSelection | undefined {
        const { selection } = latest.current
        const model = selection.model
        const agent = selection.agent
        if (!model || !agent) return
        return {
          agent: agent.name,
          model: { providerID: model.provider.id, modelID: model.id },
          variant: selection.variant,
        }
      },
      track(sessionID: string, value: ComposerSelection) {
        const expected = { agent: value.agent, model: value.model, variant: value.variant }
        pending.current.set(sessionID, expected)
        return () => {
          if (pending.current.get(sessionID) === expected) pending.current.delete(sessionID)
        }
      },
      /** A draft's session now exists: it keeps the draft's pick. */
      promote(directory: string, sessionID: string) {
        const { selection, pick } = latest.current
        const model = selection.model
        const next: SelectionState = pick ?? {
          agent: selection.agent?.name,
          model: model ? { providerID: model.provider.id, modelID: model.id } : undefined,
          variant: model ? (selection.variant ?? null) : undefined,
        }
        handoff.set(JSON.stringify([scope, directory, sessionID]), next)
        savedDocument(storage, scope, directory).set((state) => ({
          ...state,
          session: { ...state.session, [sessionID]: next },
        }))
        if (input.draftID) draftPicks.delete(input.draftID)
      },
    }),
    // write and the stores are stable for one session or draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.sessionID, input.draftID, saved, draft, prefs, storage, scope],
  )

  return { selection, ...actions }
}

export type { Selection }
