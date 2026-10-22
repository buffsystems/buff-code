// Hovering or focusing a Worktrees tab warms its inventory (#584), as in the Solid window.

import { useQueryClient } from "@tanstack/react-query"
import type { ServerConnection } from "../../core/servers"
import { useCore } from "../../react/core"
import { prefetchInventory } from "./inventory"

export function useWorkspacesPrefetch(conn: ServerConnection | undefined, projectID?: string) {
  const core = useCore()
  const client = useQueryClient()
  return () => {
    if (!conn) return
    prefetchInventory(core.registry.ensure(conn), client, projectID)
  }
}
