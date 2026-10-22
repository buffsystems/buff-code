// The side panes' share of the window layout (#584): each session's side tabs, the review's diff
// style and changes mode, and the review panel's sidebar — persisted under the Solid window's keys
// (`layout`, `review-panel-v2` in the global namespace), so both windows read one layout. Only the
// fields the panes own are typed; the rest of the stored layout is carried through untouched.

import {
  closeSessionTab,
  openSessionTab,
  previewSessionTab,
  type SessionTabs,
} from "@opencode/app/react-reuse/session-tabs"
import { createPersisted } from "../../core/persisted"
import { createStore } from "../../core/store"
import type { PlatformStorage } from "../../platform/platform"

export type DiffStyle = "unified" | "split"
export type ChangeMode = "git" | "branch" | "turn"
export type ExpandMode = "expand" | "collapse"

type SessionView = {
  scroll?: Record<string, { x: number; y: number }>
  reviewMode?: ChangeMode
  reviewFile?: string
  reviewOpen?: string[]
  [field: string]: unknown
}

export type StoredLayout = {
  review?: { diffStyle?: DiffStyle; panelOpened?: boolean; [field: string]: unknown }
  sessionTabs?: Record<string, SessionTabs>
  sessionView?: Record<string, SessionView>
  [field: string]: unknown
}

export type ReviewPanel = { sidebarOpened: boolean; sidebarWidth: number; expandMode: ExpandMode }

// Buff (#470): one column by default — two columns wrap code mid-word in a narrow panel.
export const DEFAULT_DIFF_STYLE: DiffStyle = "unified"
export const REVIEW_SIDEBAR_WIDTH_DEFAULT = 240
export const REVIEW_SIDEBAR_WIDTH_MIN = 200
export const REVIEW_SIDEBAR_WIDTH_MAX = 480
const EMPTY_TABS: SessionTabs = { all: [] }

function record(raw: string): Record<string, unknown> | undefined {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return value as Record<string, unknown>
}

const clampWidth = (width: number) =>
  Math.min(REVIEW_SIDEBAR_WIDTH_MAX, Math.max(REVIEW_SIDEBAR_WIDTH_MIN, Math.round(width)))

export function decodeReviewPanel(raw: string): ReviewPanel | undefined {
  const value = record(raw) as Partial<ReviewPanel> | undefined
  if (!value) return
  return {
    sidebarOpened: typeof value.sidebarOpened === "boolean" ? value.sidebarOpened : true,
    sidebarWidth: typeof value.sidebarWidth === "number" ? clampWidth(value.sidebarWidth) : REVIEW_SIDEBAR_WIDTH_DEFAULT,
    expandMode: value.expandMode === "expand" ? "expand" : "collapse",
  }
}

/** Every tab of a session except "review", which is never stored in the list. */
export const tabsOf = (layout: StoredLayout, key: string) => layout.sessionTabs?.[key] ?? EMPTY_TABS

function withTabs(layout: StoredLayout, key: string, tabs: SessionTabs): StoredLayout {
  return { ...layout, sessionTabs: { ...layout.sessionTabs, [key]: tabs } }
}

function withView(layout: StoredLayout, key: string, patch: Partial<SessionView>): StoredLayout {
  const current = layout.sessionView?.[key] ?? { scroll: {} }
  return { ...layout, sessionView: { ...layout.sessionView, [key]: { ...current, ...patch } } }
}

export function moveTab(all: readonly string[], tab: string, to: number) {
  const from = all.indexOf(tab)
  if (from === -1 || from === to) return [...all]
  const next = all.filter((item) => item !== tab)
  next.splice(to, 0, tab)
  return next
}

/**
 * The panes' window-wide state: the stored layout, each session's preview tab (not persisted, as in
 * the Solid window) and the review panel's sidebar.
 */
export function createPanesLayout(storage: PlatformStorage) {
  const layout = createPersisted<StoredLayout>({ storage, key: "layout", decode: record, initial: {} })
  const panel = createPersisted<ReviewPanel>({
    storage,
    key: "review-panel-v2",
    decode: decodeReviewPanel,
    initial: { sidebarOpened: true, sidebarWidth: REVIEW_SIDEBAR_WIDTH_DEFAULT, expandMode: "collapse" },
  })
  const preview = createStore<Record<string, string | undefined>>({})
  // The review filter is transient by design: a persisted filter would hide files after a reload.
  const filter = createStore("")

  const apply = (key: string, next: { tabs: SessionTabs; preview?: string }) => {
    layout.set((current) => withTabs(current, key, next.tabs))
    preview.set((current) => (current[key] === next.preview ? current : { ...current, [key]: next.preview }))
  }
  const state = (key: string) => ({ tabs: tabsOf(layout.store.get(), key), preview: preview.get()[key] })

  const tabs = (key: string) => ({
    open: (tab: string) => apply(key, openSessionTab(state(key), tab)),
    previewTab: (tab: string) => apply(key, previewSessionTab(state(key), tab)),
    close: (tab: string) => {
      if (!layout.store.get().sessionTabs?.[key]) return
      apply(key, closeSessionTab(state(key), tab))
    },
    setActive: (tab: string | undefined) =>
      layout.set((current) => withTabs(current, key, { ...tabsOf(current, key), active: tab })),
    setAll: (all: string[]) => {
      const next = all.filter((tab) => tab !== "review")
      layout.set((current) => withTabs(current, key, { ...tabsOf(current, key), all: next }))
      const kept = preview.get()[key]
      if (kept && !next.includes(kept)) preview.set((current) => ({ ...current, [key]: undefined }))
    },
    move: (tab: string, to: number) =>
      layout.set((current) => {
        const stored = current.sessionTabs?.[key]
        if (!stored) return current
        return withTabs(current, key, { ...stored, all: moveTab(stored.all, tab, to) })
      }),
  })

  const review = (key: string) => ({
    setMode: (mode: ChangeMode) => layout.set((current) => withView(current, key, { reviewMode: mode })),
    setFile: (file: string) => layout.set((current) => withView(current, key, { reviewFile: file })),
    openPath: (path: string) =>
      layout.set((current) => {
        const open = current.sessionView?.[key]?.reviewOpen ?? []
        return open.includes(path) ? current : withView(current, key, { reviewOpen: [...open, path] })
      }),
    setOpen: (paths: string[]) => layout.set((current) => withView(current, key, { reviewOpen: paths })),
  })

  return {
    layout: layout.store,
    preview,
    panel: panel.store,
    filter,
    ready: Promise.all([layout.ready, panel.ready]).then(() => undefined),
    tabs,
    review,
    setDiffStyle: (diffStyle: DiffStyle) =>
      layout.set((current) => ({ ...current, review: { panelOpened: false, ...current.review, diffStyle } })),
    setFilter: (value: string) => filter.set(() => value),
    toggleSidebar: () => panel.set((current) => ({ ...current, sidebarOpened: !current.sidebarOpened })),
    resizeSidebar: (width: number) => panel.set((current) => ({ ...current, sidebarWidth: clampWidth(width) })),
    setExpandMode: (expandMode: ExpandMode) => panel.set((current) => ({ ...current, expandMode })),
  }
}

export type PanesLayout = ReturnType<typeof createPanesLayout>

export const diffStyleOf = (layout: StoredLayout): DiffStyle => layout.review?.diffStyle ?? DEFAULT_DIFF_STYLE
export const reviewModeOf = (layout: StoredLayout, key: string) => layout.sessionView?.[key]?.reviewMode
export const reviewFileOf = (layout: StoredLayout, key: string) => layout.sessionView?.[key]?.reviewFile
