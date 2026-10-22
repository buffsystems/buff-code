// Whether the routed session is still being prepared (#584): its tab was a draft whose first
// prompt waits for a new worktree; the session itself does not exist yet (see shell/tabs/tabs.ts).

import { useStore } from "../../react/use-store"
import { useTabs } from "../../shell/tabs/provider"
import { tabKey, tabServer } from "../../shell/tabs/tabs"
import { useSession } from "../context"

/** The pending tab's key while the routed session is being prepared. */
export function usePendingSession() {
  const tabs = useTabs()
  const { server, sessionID } = useSession()
  const key = tabKey({ type: "session", server: tabServer(server.key), sessionId: sessionID })
  return useStore(tabs.pending, (all) => (all[key] ? key : undefined))
}
