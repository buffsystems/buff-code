// The window's tabs in React (#584): one store per window, the tab the route shows, and the sync
// that opens a tab for a session reached by link (a subagent session opens its root's tab).

import { createContext, use, useEffect, useState, type ReactNode } from "react"
import { serverKey } from "../../core/servers"
import { usePlatform } from "../../platform/context"
import type { Platform } from "../../platform/platform"
import { useCore, useServers } from "../../react/core"
import { useStore } from "../../react/use-store"
import { useServerByKey, useServerDataByKey } from "../server-data"
import type { History } from "../../router/history"
import { useLocation, useRoute } from "../../router/router"
import { createTabs, findSessionTab, tabKey, tabServer, type Tab, type Tabs } from "./tabs"

const TabsContext = createContext<Tabs | undefined>(undefined)

/** The window namespace the Solid window keeps window-scoped state in. */
export function windowStorageName(platform: Platform) {
  const id = platform.platform === "desktop" ? (platform.windowID ?? "") : "browser"
  return `opencode.window.${(id || "browser").replace(/[^a-zA-Z0-9._-]/g, "-")}.dat`
}

export function TabsProvider(props: { history: History; tabs?: Tabs; children?: ReactNode }) {
  const platform = usePlatform()
  const [tabs] = useState(
    () => props.tabs ?? createTabs({ storage: platform.storage(windowStorageName(platform)), history: props.history }),
  )
  const core = useCore()
  const servers = useServers()
  const keys = servers.map(serverKey)
  // Tabs of servers that left the window go with them, once the stored lists have loaded.
  useEffect(() => {
    void Promise.all([tabs.ready, core.serverState.ready]).then(() => tabs.retainServers(keys))
  }, [tabs, core, keys.join("\n")])
  return <TabsContext value={tabs}>{props.children}</TabsContext>
}

export function useTabs() {
  const tabs = use(TabsContext)
  if (!tabs) throw new Error("useTabs must be used inside TabsProvider")
  return tabs
}

export function useTabList() {
  const tabs = useTabs()
  return useStore(tabs.list, (list) => list)
}

/** The tab the route shows: a draft's, a session's, or the tab of a subagent session's root. */
export function useCurrentTab(): Tab | undefined {
  const list = useTabList()
  const route = useRoute()
  const location = useLocation()
  const parent = useRoutedParent()
  if (route.name === "new-session") {
    const draftID = new URLSearchParams(location.search).get("draftId")
    return list.find((tab) => tab.type === "draft" && tab.draftID === draftID)
  }
  if (route.name !== "session") return undefined
  const own = findSessionTab(list, route.serverKey, route.sessionID)
  if (own) return own
  if (!parent) return undefined
  return list.find((tab) => tab.type === "session" && tab.server === route.serverKey && tab.sessionId === parent)
}

/** The routed session's info, when the routed server is in the window and knows it. */
function useRoutedSession() {
  const route = useRoute()
  const server = useServerByKey(route.name === "session" ? route.serverKey : undefined)
  const sessionID = route.name === "session" ? route.sessionID : ""
  const session = useServerDataByKey(
    route.name === "session" ? route.serverKey : undefined,
    (state) => state.session.info[sessionID],
  )
  return { server, sessionID, session }
}

function useRoutedParent() {
  return useRoutedSession().session?.parentID
}

/** Opens a tab for a session reached by link, and keeps each tab's title and route current. */
export function TabRouteSync() {
  const tabs = useTabs()
  const route = useRoute()
  const current = useCurrentTab()
  const { server, sessionID, session } = useRoutedSession()
  const ready = useTabsReady()
  const key = current ? tabKey(current) : undefined
  // A session still being prepared (a new worktree first) is reopened by its link too.
  const pending = useStore(tabs.pending, (all) =>
    route.name === "session"
      ? !!all[tabKey({ type: "session", server: tabServer(route.serverKey), sessionId: route.sessionID })]
      : false,
  )
  useEffect(() => {
    if (!ready) return
    if (current) {
      if (current.type === "session" && route.name === "session")
        tabs.rememberSessionRoute(current, sessionID, session?.parentID)
      tabs.remember(current)
      return
    }
    if (route.name !== "session" || (!session && !pending)) return
    tabs.addSessionTab({
      server: tabServer(route.serverKey),
      sessionId: session ? (session.parentID ?? session.id) : sessionID,
    })
  }, [ready, key, route.name, sessionID, session?.id, session?.parentID, pending])
  // Every visit reads the routed session again, as the Solid titlebar does: a cached subagent
  // shows in its root's tab at once while its info resolves.
  useEffect(() => {
    if (!server || !sessionID || pending) return
    server.data.session.invalidate(sessionID)
    void server.data.session.sync(sessionID).catch(() => undefined)
  }, [server, sessionID, pending])
  return null
}

function useTabsReady() {
  const tabs = useTabs()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const current = { live: true }
    void tabs.ready.then(() => current.live && setReady(true))
    return () => {
      current.live = false
    }
  }, [tabs])
  return ready
}
