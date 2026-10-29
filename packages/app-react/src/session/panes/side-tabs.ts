// Which tabs the side panel shows and which one is selected (#584): the Solid window's
// createSessionTabs as one pure function of the stored tab list.

import {
  isSessionBrowserTab,
  SESSION_OPEN_FILE_TAB,
  sideSessionOf,
  type SessionTabs,
} from "@opencode/app/react-reuse/session-tabs"

export type SideTabsInput = {
  tabs: SessionTabs
  pathFromTab: (tab: string) => string | undefined
  normalizeTab: (tab: string) => string
  /** The review tab can be shown (desktop). */
  review: boolean
  /** The session has changes to review. */
  hasReview: boolean
  fileBrowser: boolean
  browser: boolean
}

export type SideTabs = {
  contextOpen: boolean
  openFileOpen: boolean
  /** The tabs after Review and Context, in their stored order, file tabs normalized and unique. */
  panelTabs: string[]
  /** The file tabs among them. */
  openedTabs: string[]
  activeTab: string
  activeFileTab?: string
  closableTab?: string
}

export function deriveSideTabs(input: SideTabsInput): SideTabs {
  const all = input.tabs.all.filter((tab) => tab !== "review")
  const active = input.tabs.active
  const contextOpen = active === "context" || all.includes("context")
  const openFileOpen = input.fileBrowser && (active === SESSION_OPEN_FILE_TAB || all.includes(SESSION_OPEN_FILE_TAB))
  const seen = new Set<string>()
  const panelTabs = all.flatMap((tab) => {
    if (tab === "context") return []
    if (isSessionBrowserTab(tab)) return input.browser ? [tab] : []
    if (tab === SESSION_OPEN_FILE_TAB && !input.fileBrowser) return []
    const value = input.pathFromTab(tab) ? input.normalizeTab(tab) : tab
    if (seen.has(value)) return []
    seen.add(value)
    return [value]
  })
  const openedTabs = panelTabs.filter(
    (tab) => tab !== SESSION_OPEN_FILE_TAB && !isSessionBrowserTab(tab) && !sideSessionOf(tab),
  )
  const activeTab = selectActive({ ...input, active, contextOpen, openFileOpen, openedTabs })
  const activeFileTab = openedTabs.includes(activeTab) ? activeTab : undefined
  return {
    contextOpen,
    openFileOpen,
    panelTabs,
    openedTabs,
    activeTab,
    activeFileTab,
    closableTab: closable({ ...input, activeTab, openFileOpen, openedTabs }),
  }
}

function selectActive(
  input: SideTabsInput & { active?: string; contextOpen: boolean; openFileOpen: boolean; openedTabs: string[] },
) {
  const active = input.active
  if (active === "context") return active
  if (active === SESSION_OPEN_FILE_TAB && input.openFileOpen) return active
  if (active && isSessionBrowserTab(active) && input.browser) return active
  if (active && sideSessionOf(active)) return active
  if (active === "review" && input.review) return active
  if (active && input.pathFromTab(active)) return input.normalizeTab(active)
  const first = input.openedTabs[0]
  if (first) return first
  if (input.contextOpen) return "context"
  if (input.review && input.hasReview) return "review"
  return "empty"
}

function closable(input: SideTabsInput & { activeTab: string; openFileOpen: boolean; openedTabs: string[] }) {
  const active = input.activeTab
  if (active === "context") return active
  if (active === SESSION_OPEN_FILE_TAB && input.openFileOpen) return active
  if (isSessionBrowserTab(active) && input.browser) return active
  if (sideSessionOf(active)) return active
  if (input.openedTabs.includes(active)) return active
}

/** The file browser shows for every tab that is not Review, Context, empty, a browser or a side chat. */
export const fileBrowserVisible = (active: string) =>
  active !== "review" &&
  active !== "context" &&
  active !== "empty" &&
  !isSessionBrowserTab(active) &&
  // Buff (#464): a side conversation is a tab of its own.
  !sideSessionOf(active)

/**
 * Buff (#705): the file-tree toggle shows where there is a tree — Review and a file's tab. On
 * Context, a browser, a side chat or the «open a file» placeholder it toggled nothing seen.
 */
export const fileTreeToggles = (active: string) =>
  active === "review" || (fileBrowserVisible(active) && active !== SESSION_OPEN_FILE_TAB)
