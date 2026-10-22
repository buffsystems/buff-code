// Moving between a session and its subagents (#584), the Solid window's navigateToSession: the
// tab showing the session remembers where it goes (so it stays the selected tab), the target
// resolves first (the current session stays on screen meanwhile), then the route moves.

import { useCallback } from "react"
import type { Server } from "../core/servers"
import { sessionHref } from "../router/routes"
import { useNavigate } from "../router/router"
import { useTabs } from "../shell/tabs/provider"
import { findSessionTab } from "../shell/tabs/tabs"

export function useNavigateToSession(server: Server, from: string) {
  const tabs = useTabs()
  const navigate = useNavigate()
  return useCallback(
    async (sessionID: string) => {
      const tab = findSessionTab(tabs.tabs(), server.key, from)
      if (tab) tabs.rememberSessionRoute(tab, sessionID, from)
      await server.data.session.sync(sessionID).catch(() => undefined)
      navigate(sessionHref(server.key, sessionID))
    },
    [tabs, navigate, server, from],
  )
}
