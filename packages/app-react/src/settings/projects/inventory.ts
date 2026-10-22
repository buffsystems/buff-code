// The worktree inventory settings shows (#584), ported from the Solid window's settings/workspaces/
// queries.ts and workspaces/inventory.ts on react-query: the server's projects (metadata cached
// half a minute) with each project's saved worktree list, read again when the server announces a
// change (worktree.updated) or settings ask for it.

import type { Project, WorktreeDirectory } from "@opencode/client/promise"
import { queryOptions, type QueryClient } from "@tanstack/react-query"
import type { Server } from "../../core/servers"

/** A project with its worktrees, in the Solid window's shape (worktree = the canonical directory). */
export type InventoryProject = Omit<Project, "canonical"> & { worktree: string; worktrees: WorktreeDirectory[] }

export const worktreeKey = (server: string, projectID: string) => [server, "worktree", projectID] as const
export const inventoryKey = (server: string, projectID?: string) =>
  [server, "settings-workspace-inventory", projectID ?? null] as const

export function projectsQuery(server: Server) {
  return queryOptions({
    queryKey: [server.key, "settings-workspace-project-metadata"],
    queryFn: () => server.api().project.list(),
    staleTime: 30_000,
  })
}

/** One project's worktrees; a failed read leaves undefined (the screen tells failure apart). */
export function worktreesQuery(server: Server, projectID: string) {
  return queryOptions({
    queryKey: worktreeKey(server.key, projectID),
    queryFn: () => server.api().worktree.list({ projectID }),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
}

export function inventoryQuery(server: Server, client: QueryClient, projectID?: string) {
  return queryOptions({
    queryKey: inventoryKey(server.key, projectID),
    queryFn: async (): Promise<InventoryProject[]> => {
      const projects = (await client.fetchQuery(projectsQuery(server))).filter(
        (project) => projectID === undefined || project.id === projectID,
      )
      return Promise.all(
        projects.map(async (project) => {
          const listed = await client
            .fetchQuery({ ...worktreesQuery(server, project.id), staleTime: 0 })
            .catch(() => undefined)
          const worktrees = listed ?? [
            { directory: project.canonical },
            ...project.sandboxes.map((directory) => ({ directory })),
          ]
          const { canonical, ...rest } = project
          return { ...rest, worktree: canonical, worktrees }
        }),
      )
    },
    staleTime: 30_000,
  })
}

/** Whether the last read of a project's worktree list failed. */
export function worktreesFailed(client: QueryClient, server: Server, projectID: string) {
  return client.getQueryState(worktreeKey(server.key, projectID))?.status === "error"
}

/** Re-read the lists when the server says a project's worktrees changed; returns the stop. */
export function followWorktreeUpdates(server: Server, client: QueryClient) {
  return server.event.listen((event) => {
    if (event.type !== "worktree.updated") return
    void client.invalidateQueries({ queryKey: worktreeKey(server.key, event.data.projectID) })
    void client.invalidateQueries({ queryKey: [server.key, "settings-workspace-inventory"] })
  })
}

/**
 * Warm the inventory before the Worktrees page opens (hover or focus on its tab): a project's
 * own inventory, or for a whole server only the project metadata, without booting every project.
 */
export function prefetchInventory(server: Server, client: QueryClient, projectID?: string) {
  if (server.connection.get().status !== "connected") return
  if (projectID) return void client.prefetchQuery(inventoryQuery(server, client, projectID))
  void client.prefetchQuery(projectsQuery(server))
}

/**
 * Showing a project's place (a session, a project page) is the demand for its worktree inventory: the saved list (into the
 * shared query cache), then discovery. A failed listing rejects, so its owner can retry it while
 * it still shows (the Solid window's inventory demand).
 */
export function worktreeDemand(input: { client: QueryClient; server: Server; projectID: string }) {
  return async () => {
    await input.client.fetchQuery({ ...worktreesQuery(input.server, input.projectID), staleTime: 0 })
    await input.server
      .api()
      .worktree.refresh({ projectID: input.projectID })
      .catch(() => undefined)
  }
}
