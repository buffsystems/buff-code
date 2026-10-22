// A session's desktop browser (#584): the Solid createSessionBrowser as two hooks. `useSessionBrowser`
// reads the session's attachment and acts on it (for the side panel); `useBrowserCommands`, mounted
// once per session screen, attaches the browser, registers "Open browser", keeps the side panel's
// browser tabs in step with the desktop's tabs and wakes the browser when the person returns.

import { isSessionBrowserTab, sessionBrowserTab } from "@opencode/app/react-reuse/session-tabs"
import type { BrowserPaneCommand, BrowserPaneRegistration } from "@opencode/app/react-reuse/browser-pane"
import type { SessionTabs } from "@opencode/app/react-reuse/session-tabs"
import { useEffect, useMemo, useRef, useState } from "react"
import { useCommandRegistration } from "../../../commands/provider"
import { createStore } from "../../../core/store"
import { useI18n } from "../../../i18n/provider"
import { useCore } from "../../../react/core"
import { useStore } from "../../../react/use-store"
import { findSessionTab, tabKey } from "../../../shell/tabs/tabs"
import { useTabList } from "../../../shell/tabs/provider"
import { useSessionView } from "../../context"
import { tabsOf, type PanesLayout } from "../layout"
import type { Server } from "../../../core/servers"
import { usePaneSession } from "../session"
import { attachmentKey, type BrowserAttachment, type BrowserAttachments, type BrowserServer, type BrowserTabID, type BrowserTabState } from "./attachments"
import { browserWindow, syncTabOwnership } from "./window"

const NONE = createStore<Record<string, BrowserAttachment | undefined>>({})
const NO_SERVERS = createStore<Record<string, true | undefined>>({})
const OFF = createStore(false)
const EMPTY: SessionTabs = { all: [] }
const NO_TABS: BrowserTabState[] = []

function useBrowserWindow() {
  const core = useCore()
  const i18n = useI18n()
  return browserWindow(core, {
    replaced: i18n.t("session.browser.replaced"),
    failed: i18n.t("common.requestFailed"),
  })
}

export type SessionBrowser = {
  available: boolean
  attached: boolean
  opened: boolean
  state: BrowserAttachment["browser"]
  tabs: BrowserTabState[]
  active?: BrowserTabState
  error?: string
  suspended: boolean
  registration?: BrowserPaneRegistration
  open: () => void
  close: (tabID: BrowserTabID) => void
  focus: (tabID: BrowserTabID) => void
  command: (action: BrowserPaneCommand) => void
  attachments?: BrowserAttachments
  server: Server
  sessionID: string
  sideTabs?: ReturnType<PanesLayout["tabs"]>
  stored: SessionTabs
  readTabs: () => SessionTabs
}

export function useSessionBrowser(): SessionBrowser {
  const i18n = useI18n()
  const session = usePaneSession()
  const view = useSessionView()
  const browser = useBrowserWindow()
  const attachments = browser?.attachments
  const id = attachmentKey(session.server.key, session.sessionID)
  const attachment = useStore(attachments?.store ?? NONE, (all) => all[id])
  const unsupported = useStore(attachments?.unsupported ?? NO_SERVERS, (all) => !!all[session.server.key])
  const enabled = useStore(browser?.enabled ?? OFF, (value) => value)
  const stored = useStore(session.window.layout.layout, (state) =>
    session.sessionKey ? tabsOf(state, session.sessionKey) : EMPTY,
  )
  const [failure, setFailure] = useState<string>()
  const tabs = useMemo(
    () =>
      attachment?.browser?.tabs.filter((tab) => stored.all.includes(sessionBrowserTab(tab.id))) ?? NO_TABS,
    [attachment?.browser, stored.all],
  )
  const sideTabs = session.sessionKey ? session.window.layout.tabs(session.sessionKey) : undefined
  const available = !!attachments && enabled && !unsupported
  const attached = !!(attachment?.registration || attachment?.browser)

  const command = (action: BrowserPaneCommand) => {
    if (!attachments) return
    setFailure(undefined)
    void attachments.command(session.server.key, session.sessionID, action).catch(() => {
      setFailure(i18n.t("common.requestFailed"))
    })
  }

  return {
    available,
    attached,
    opened: attached && tabs.length > 0,
    state: attachment?.browser ?? null,
    tabs,
    active:
      tabs.find((tab) => sessionBrowserTab(tab.id) === stored.active) ??
      tabs.find((tab) => tab.id === attachment?.browser?.focusedTabID) ??
      tabs[0],
    error: failure ?? attachment?.error,
    suspended: attachment?.suspended ?? false,
    registration: attachment?.registration,
    open: () => {
      if (available) command({ type: "tabs.open" } as BrowserPaneCommand)
    },
    close: (tabID: BrowserTabID) => sideTabs?.close(sessionBrowserTab(tabID)),
    /** Show a desktop tab in the side panel and select it. */
    focus: (tabID: BrowserTabID) => {
      view.openReview()
      if (!sideTabs) return
      const key = sessionBrowserTab(tabID)
      if (!stored.all.includes(key)) sideTabs.setAll([...stored.all, key])
      sideTabs.setActive(key)
    },
    command,
    attachments,
    server: session.server,
    sessionID: session.sessionID,
    sideTabs,
    stored,
    /** The stored side tabs now, after changes this render has not seen. */
    readTabs: () =>
      session.sessionKey ? tabsOf(session.window.layout.layout.get(), session.sessionKey) : EMPTY,
  }
}


/** Attach, command and sync the session's browser; mount once per session screen. */
export function useBrowserCommands() {
  const i18n = useI18n()
  const browser = useSessionBrowser()
  const list = useTabList()
  const latest = useRef(browser)
  latest.current = browser
  const { attachments, server, sessionID, available } = browser

  useCommandRegistration("session.browser", () => [
    {
      id: "browser.open",
      title: i18n.t("command.browser.open"),
      category: i18n.t("command.category.view"),
      keybind: "mod+shift+b",
      disabled: !latest.current.available,
      onSelect: latest.current.open,
    },
  ])

  // The attachment lives with the window; this screen only starts it and hears focus requests.
  useEffect(() => {
    if (!attachments || !available) return
    const target: BrowserServer = {
      key: server.key,
      endpoint: () => server.conn.http,
      listen: (handler) => server.event.listen(handler),
    }
    attachments.attach(target, sessionID)
    const stop = attachments.onFocus(server.key, sessionID, (tabID) => latest.current.focus(tabID))
    const wake = () => {
      if (document.visibilityState === "visible") attachments.wake(server.key, sessionID)
    }
    wake()
    window.addEventListener("focus", wake)
    document.addEventListener("visibilitychange", wake)
    document.addEventListener("pointerdown", wake)
    document.addEventListener("keydown", wake)
    return () => {
      stop()
      window.removeEventListener("focus", wake)
      document.removeEventListener("visibilitychange", wake)
      document.removeEventListener("pointerdown", wake)
      document.removeEventListener("keydown", wake)
    }
  }, [attachments, available, server, sessionID])

  // Closing the session's shell tab closes its browser.
  useEffect(() => {
    if (!attachments) return
    const keys = new Set(list.map(tabKey))
    syncTabOwnership(
      attachments,
      (serverKey, id) => {
        const tab = findSessionTab(list, serverKey, id)
        return tab ? tabKey(tab) : undefined
      },
      (key) => keys.has(key),
    )
  }, [attachments, list])

  // Selecting a browser tab focuses it on the desktop.
  const active = browser.stored.active
  useEffect(() => {
    const current = latest.current
    const tab = current.state?.tabs.find((item) => sessionBrowserTab(item.id) === active)
    if (tab && tab.id !== current.state?.focusedTabID)
      current.command({ type: "tabs.focus", tabID: tab.id } as BrowserPaneCommand)
  }, [active])

  // A browser tab closed in the side panel closes on the desktop.
  const all = browser.stored.all
  const previousAll = useRef(all)
  useEffect(() => {
    const previous = previousAll.current
    previousAll.current = all
    const current = latest.current
    previous
      .filter((key) => isSessionBrowserTab(key) && !all.includes(key))
      .forEach((key) => {
        const tab = current.state?.tabs.find((item) => sessionBrowserTab(item.id) === key)
        if (tab) current.command({ type: "tabs.close", tabID: tab.id } as BrowserPaneCommand)
      })
  }, [all])

  // The desktop's tabs mirror into the side panel; only tabs new since the last inventory are
  // added, so a tab the person just closed is not reopened before the desktop confirms.
  const inventory = browser.state?.tabs.map((tab) => sessionBrowserTab(tab.id))
  const inventoryKey = inventory?.join("\n")
  const previousInventory = useRef<string[] | undefined>(undefined)
  useEffect(() => {
    if (!inventory) return
    const known = new Set(previousInventory.current ?? [])
    previousInventory.current = inventory
    const current = latest.current
    const sideTabs = current.sideTabs
    if (!sideTabs) return
    current.readTabs().all.filter((key) => isSessionBrowserTab(key) && !inventory.includes(key)).forEach(sideTabs.close)
    const after = current.readTabs().all
    const added = inventory.filter((key) => !known.has(key) && !after.includes(key))
    if (added.length) sideTabs.setAll([...after, ...added])
  }, [inventoryKey])
}
