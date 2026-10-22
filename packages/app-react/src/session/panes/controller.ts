// The side panel's state for one session (#584): its stored tabs, which one shows, and the
// actions on them — the Solid SessionSidePanel's tab logic, shared by the panel and by the
// commands and the review toggle over it.

import { SESSION_OPEN_FILE_TAB, type SessionTabs } from "@opencode/app/react-reuse/session-tabs"
import { useMemo } from "react"
import { createStore } from "../../core/store"
import { useStore } from "../../react/use-store"
import { useSessionView } from "../context"
import { tabsOf } from "./layout"
import { useSessionBrowser } from "./browser/model"
import { usePaneSession } from "./session"
import { deriveSideTabs } from "./side-tabs"

const EMPTY: SessionTabs = { all: [] }

/** Bumped to move focus into the file browser's filter once it is shown. */
export const filterFocus = createStore(0)

export function useSideController() {
  const session = usePaneSession()
  const view = useSessionView()
  const browser = useSessionBrowser()
  const { files, sessionKey, window } = session
  const stored = useStore(window.layout.layout, (state) => (sessionKey ? tabsOf(state, sessionKey) : EMPTY))
  const preview = useStore(window.layout.preview, (state) => (sessionKey ? state[sessionKey] : undefined))
  const tabs = useMemo(() => (sessionKey ? window.layout.tabs(sessionKey) : undefined), [window, sessionKey])
  const normalizeTab = (tab: string) => (files && tab.startsWith("file://") ? files.tab(tab) : tab)
  const pathFromTab = (tab: string) => files?.pathFromTab(tab)
  const derived = deriveSideTabs({
    tabs: stored,
    pathFromTab,
    normalizeTab,
    review: true,
    hasReview: true,
    fileBrowser: true,
    browser: browser.attached,
  })

  const load = (tab: string) => {
    const path = pathFromTab(tab)
    if (path) void files?.load(path)
  }
  const activate = (value: string) => {
    const next = normalizeTab(value)
    load(next)
    view.openReview()
    tabs?.setActive(next)
  }
  const previewTab = (value: string) => {
    const next = normalizeTab(value)
    tabs?.previewTab(next)
    load(next)
    view.openReview()
  }
  const openTab = (value: string) => {
    const next = normalizeTab(value)
    tabs?.open(next)
    if (!pathFromTab(next)) return
    load(next)
    view.openReview()
  }
  const openFileBrowser = () => {
    previewTab(SESSION_OPEN_FILE_TAB)
    filterFocus.set((count) => count + 1)
  }

  return {
    session,
    view,
    browser,
    stored,
    preview,
    derived,
    normalizeTab,
    pathFromTab,
    activate,
    previewTab,
    openTab,
    openFile: (path: string) => files && openTab(files.tab(path)),
    openFileBrowser,
    openContext: () => {
      tabs?.open("context")
      view.openReview()
    },
    close: (tab: string) => tabs?.close(tab),
    closeActive: () => derived.closableTab && tabs?.close(derived.closableTab),
    move: (tab: string, index: number) => tabs?.move(tab, index),
  }
}

export type SideController = ReturnType<typeof useSideController>
