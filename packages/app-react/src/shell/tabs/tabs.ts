// The window's tabs (#584): open session and draft tabs, the most recent tab, each tab's last
// known title and the recently closed stack — persisted in the window namespace under the keys the
// Solid window uses (tabs, tabs.recent, tabs.info, tabs.closed, tabs.panes), so both windows read one
// list. Each tab's panes (review and terminal shown, their sizes) live and die with the tab.
// Plain TS over persisted stores; navigation goes through the window history.

import {
  nextTabAfterClose,
  pushClosedTab,
  removeClosedTabs,
  takeClosedTab,
} from "@opencode/app/react-reuse/closed-tabs"
import { TabStorage } from "@opencode/app/react-reuse/tab-schema"
import type { SessionMessageUser } from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { createPersisted } from "../../core/persisted"
import { createStore } from "../../core/store"
import type { PlatformStorage } from "../../platform/platform"
import type { History } from "../../router/history"
import { sessionHref } from "../../router/routes"

export type SessionTab = typeof TabStorage.Session.Type
export type DraftTab = typeof TabStorage.Draft.Type
export type Tab = typeof TabStorage.Tab.Type
export type TabInfo = typeof TabStorage.Info.Type
/** A session started from a draft while its worktree is created: the tab shows it already. */
export type PendingSession = { draft: DraftTab; message?: SessionMessageUser }
type ClosedTab = typeof TabStorage.ClosedTab.Type
/** A tab's panes: review and terminal shown, the terminal's height and the chat panel's width. */
export type TabPanes = { review?: boolean; terminal?: boolean; terminalHeight?: number; sessionWidth?: number }

/** A server key as the tab schema brands it. */
export const tabServer = Schema.decodeSync(TabStorage.ServerKey)

export const draftHref = (draftID: string) => `/new-session?draftId=${encodeURIComponent(draftID)}`

export const tabHref = (tab: Tab) =>
  tab.type === "draft" ? draftHref(tab.draftID) : sessionHref(tab.server, tab.routeSessionId ?? tab.sessionId)

export const tabKey = (tab: Tab) =>
  tab.type === "draft" ? `draft:${tab.draftID}` : `${tab.server}\n${sessionHref(tab.server, tab.sessionId)}`

export function findSessionTab(tabs: readonly Tab[], server: string, sessionID: string) {
  return tabs.find(
    (tab): tab is SessionTab =>
      tab.type === "session" &&
      tab.server === server &&
      (tab.sessionId === sessionID || tab.routeSessionId === sessionID),
  )
}

function cell<Value>(storage: PlatformStorage, key: string, schema: Schema.Codec<Value, unknown>, initial: Value) {
  const decode = Schema.decodeUnknownOption(Schema.fromJsonString(schema))
  return createPersisted({ storage, key, decode: (raw) => Option.getOrUndefined(decode(raw)), initial })
}

export function createTabs(input: {
  storage: PlatformStorage
  history: Pick<History, "navigate" | "location">
  newID?: () => string
}) {
  const list = cell<Tab[]>(input.storage, "tabs", TabStorage.Tabs as Schema.Codec<Tab[], unknown>, [])
  const recent = cell(input.storage, "tabs.recent", TabStorage.Recent as Schema.Codec<{ key?: string }, unknown>, {})
  const info = cell<Record<string, TabInfo>>(
    input.storage,
    "tabs.info",
    TabStorage.Infos as Schema.Codec<Record<string, TabInfo>, unknown>,
    {},
  )
  const closed = cell<ClosedTab[]>(
    input.storage,
    "tabs.closed",
    TabStorage.Closed as Schema.Codec<ClosedTab[], unknown>,
    [],
  )
  const panes = cell<Record<string, TabPanes>>(
    input.storage,
    "tabs.panes",
    TabStorage.Panes as Schema.Codec<Record<string, TabPanes>, unknown>,
    {},
  )
  const ready = Promise.all([list.ready, recent.ready, info.ready, closed.ready, panes.ready]).then(() => {
    const keys = new Set(tabs().map(tabKey))
    dropPanes(Object.keys(panes.store.get()).filter((key) => !keys.has(key)))
  })
  const newID = input.newID ?? (() => crypto.randomUUID())

  const tabs = () => list.store.get()
  const recentKey = () => recent.store.get().key
  const setRecent = (key: string | undefined) => {
    if (recentKey() !== key) recent.set(() => (key === undefined ? {} : { key }))
  }
  const dropPanes = (keys: string[]) => {
    const drop = new Set(keys)
    if (Object.keys(panes.store.get()).some((key) => drop.has(key)))
      panes.set((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !drop.has(key))))
  }
  const forget = (keys: string[]) => {
    dropPanes(keys)
    const drop = new Set(keys)
    if (Object.keys(info.store.get()).some((key) => drop.has(key)))
      info.set((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !drop.has(key))))
    const key = recentKey()
    if (key && drop.has(key)) setRecent(undefined)
  }
  const select = (tab: Tab) => {
    setRecent(tabKey(tab))
    input.history.navigate(tabHref(tab))
  }
  const pathname = () => input.history.location.get().pathname
  const pending = createStore<Record<string, PendingSession | undefined>>({})
  const showsDraft = (draftID: string) => {
    const location = input.history.location.get()
    return location.pathname === "/new-session" && new URLSearchParams(location.search).get("draftId") === draftID
  }

  const removeTab = (index: number) => {
    const tab = tabs()[index]
    if (!tab) return
    const key = tabKey(tab)
    const next = nextTabAfterClose(tabs(), index, recentKey() === key && pathname() !== "/")
    list.set((current) => current.filter((_, position) => position !== index))
    forget([key])
    if (next === null) input.history.navigate("/")
    if (next) select(next)
  }

  return {
    list: list.store,
    recent: recent.store,
    info: info.store,
    closed: closed.store,
    panes: panes.store,
    ready,
    /** Merge a change into a tab's panes. */
    setPanes(key: string, patch: TabPanes) {
      const current = panes.store.get()[key]
      if (current && Object.entries(patch).every(([field, value]) => current[field as keyof TabPanes] === value)) return
      panes.set((all) => ({ ...all, [key]: { ...all[key], ...patch } }))
    },
    tabs,
    recentKey,
    select,
    remember: (tab: Tab) => setRecent(tabKey(tab)),
    addSessionTab(tab: Omit<SessionTab, "type">) {
      const next: SessionTab = { type: "session", ...tab }
      const existing = tabs().find((item): item is SessionTab => tabKey(item) === tabKey(next))
      if (existing) return existing
      list.set((current) => [...current, next])
      return next
    },
    newDraft(draft: Omit<DraftTab, "type" | "draftID">) {
      const tab: DraftTab = { type: "draft", draftID: newID(), ...draft }
      list.set((current) => [...current, tab])
      select(tab)
      return tab
    },
    updateDraft(draftID: string, patch: Partial<Omit<DraftTab, "type" | "draftID">>) {
      list.set((current) =>
        current.map((tab) => (tab.type === "draft" && tab.draftID === draftID ? { ...tab, ...patch } : tab)),
      )
    },
    draft: (draftID: string) => tabs().find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === draftID),
    /** A sent draft becomes its session's tab in place; the window follows it if it was showing. */
    promoteDraft(draftID: string, session: Omit<SessionTab, "type">) {
      const next: SessionTab = { type: "session", ...session }
      const location = input.history.location.get()
      const active =
        location.pathname === "/new-session" && new URLSearchParams(location.search).get("draftId") === draftID
      list.set((current) => current.map((tab) => (tab.type === "draft" && tab.draftID === draftID ? next : tab)))
      if (recentKey() === `draft:${draftID}`) setRecent(tabKey(next))
      if (active) select(next)
    },
    reorder(keys: string[]) {
      list.set((current) => {
        const byKey = new Map(current.map((tab) => [tabKey(tab), tab]))
        const next = keys.flatMap((key) => byKey.get(key) ?? [])
        return next.length === current.length ? next : current
      })
    },
    removeTab,
    pending,
    pendingSession: (server: string, sessionID: string) =>
      pending.get()[tabKey({ type: "session", server: tabServer(server), sessionId: sessionID })],
    /**
     * The draft's tab becomes the session's tab before the session exists (a worktree is being
     * created first); `complete` keeps it, `rollback` restores the draft — with the created
     * worktree selected when one exists — and returns the window to it.
     */
    prepareSession(draftID: string, session: Omit<SessionTab, "type">, preview: { message?: SessionMessageUser }) {
      const draft = tabs().find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === draftID)
      if (!draft) throw new Error(`Draft not found: ${draftID}`)
      const next: SessionTab = { type: "session", ...session }
      const key = tabKey(next)
      const active = showsDraft(draftID)
      pending.set((all) => ({ ...all, [key]: { draft, message: preview.message } }))
      list.set((current) => current.map((tab) => (tab.type === "draft" && tab.draftID === draftID ? next : tab)))
      if (recentKey() === tabKey(draft)) setRecent(key)
      if (active) select(next)
      const settle = () =>
        pending.set((all) => Object.fromEntries(Object.entries(all).filter(([item]) => item !== key)))
      return {
        complete: async () => {
          if (pending.get()[key]) settle()
        },
        rollback: async (worktree?: string) => {
          if (!pending.get()[key]) return
          const restored: DraftTab = worktree === undefined ? draft : { ...draft, worktree, branch: undefined }
          const showing = pathname() === sessionHref(next.server, next.sessionId)
          list.set((current) => current.map((tab) => (tabKey(tab) === key ? restored : tab)))
          if (recentKey() === key) setRecent(tabKey(restored))
          if (showing) select(restored)
          settle()
          closed.set((stack) => removeClosedTabs(stack, next.server, [next.sessionId]))
          forget([key])
        },
      }
    },
    /** User-initiated close: the tab can be reopened. */
    closeTab(index: number) {
      const tab = tabs()[index]
      if (!tab) return
      closed.set((stack) => pushClosedTab(stack, tab, index))
      removeTab(index)
    },
    reopenClosedTab() {
      const result = takeClosedTab(closed.store.get(), tabs())
      if (result.stack.length === closed.store.get().length) return
      closed.set(() => result.stack)
      const entry = result.entry
      if (!entry) return
      const index = Math.min(entry.index, tabs().length)
      list.set((current) =>
        current.some((item) => tabKey(item) === tabKey(entry.tab))
          ? current
          : [...current.slice(0, index), entry.tab, ...current.slice(index)],
      )
      select(entry.tab)
    },
    /** Sessions deleted or archived elsewhere: their tabs go, and the window moves off them. */
    removeSessions(server: string, sessionIDs: string[]) {
      const ids = new Set(sessionIDs)
      const gone = (tab: Tab) => tab.type === "session" && tab.server === server && ids.has(tab.sessionId)
      const current = tabs()
      const removed = current.filter(gone)
      if (removed.length === 0) return
      closed.set((stack) => removeClosedTabs(stack, tabServer(server), sessionIDs))
      const location = pathname()
      const shown = current.findIndex(
        (tab) => tab.type === "session" && location === sessionHref(tab.server, tab.sessionId),
      )
      const remaining = current.filter((tab) => !gone(tab))
      list.set(() => remaining)
      forget(removed.map(tabKey))
      const showing = current[shown]
      if (!showing || !gone(showing)) return
      const after = current.slice(shown).find((tab) => tab.type === "session" && !gone(tab))
      const before = current.slice(0, shown).findLast((tab) => tab.type === "session" && !gone(tab))
      const next = after ?? before
      if (next) select(next)
      else input.history.navigate("/")
    },
    /** Servers no longer in the window take their tabs with them. */
    retainServers(keys: string[]) {
      const keep = new Set(keys)
      const removed = tabs().filter((tab) => !keep.has(tab.server))
      if (removed.length === 0) return
      list.set((current) => current.filter((tab) => keep.has(tab.server)))
      closed.set((stack) => stack.filter((entry) => keep.has(entry.tab.server)))
      forget(removed.map(tabKey))
    },
    rememberSessionInfo(tab: SessionTab, session: { title?: string; location: { directory: string } }) {
      const key = tabKey(tab)
      const current = info.store.get()[key]
      if (current && current.title === session.title && current.directory === session.location.directory) return
      info.set((all) => ({ ...all, [key]: { title: session.title, directory: session.location.directory } }))
    },
    /** A subagent session shows in its root's tab; the tab remembers where it is. */
    rememberSessionRoute(tab: SessionTab, sessionID: string, parentID?: string) {
      list.set((current) =>
        current.map((item) => {
          if (item.type !== "session" || tabKey(item) !== tabKey(tab)) return item
          const { routeSessionId: _route, routeParentId: _parent, ...base } = item
          if (sessionID === item.sessionId) return base
          return { ...base, routeSessionId: sessionID, ...(parentID ? { routeParentId: parentID } : {}) }
        }),
      )
    },
    /** Home toggles with the last tab: from Home back to it, from a tab to Home. */
    toggleHome(home: boolean, current?: Tab) {
      if (home) {
        const tab = tabs().find((item) => tabKey(item) === recentKey())
        if (tab) select(tab)
        return
      }
      if (current) setRecent(tabKey(current))
      input.history.navigate("/")
    },
  }
}

export type Tabs = ReturnType<typeof createTabs>
