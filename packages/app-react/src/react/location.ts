// A shown place's reads (#584), ported from the Solid window's LocationProvider: while the server is
// connected the directory and its catalogs are read, and showing it is the demand for its
// project's worktree inventory. Both are retried while the place still shows (the shared
// readWhileCurrent), and read again after a reconnect or when the directory changes.

import { readWhileCurrent } from "@opencode/app/react-reuse/current-read"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { locationKey } from "../core/data/state"
import type { Server } from "../core/servers"
import { worktreeDemand, worktreesQuery } from "../settings/projects/inventory"
import { useConnection, useServerData } from "./core"

export function useLocation(server: Server, directory: string | undefined, enabled = true) {
  const connected = useConnection(server).status === "connected"
  const live = enabled && connected

  useEffect(() => {
    if (!live || !directory) return
    // A failed read does not prove the directory is missing; recovery stays with the reads.
    return readWhileCurrent(() => server.data.location.sync({ directory }))
  }, [server, directory, live])

  const projectID = useServerData(server, (state) =>
    directory ? state.location[locationKey({ directory })]?.info?.project.id : undefined,
  )
  const client = useQueryClient()
  const inventory = useQuery({ ...worktreesQuery(server, projectID ?? ""), enabled: false })

  useEffect(() => {
    if (!live || !projectID) return
    const stops = [readWhileCurrent(worktreeDemand({ client, server, projectID }))]
    const list = () => client.fetchQuery({ ...worktreesQuery(server, projectID), staleTime: 0 })
    stops.push(
      server.event.on("worktree.updated", (event) => {
        if (event.data.projectID === projectID) stops.push(readWhileCurrent(list))
      }),
    )
    return () => stops.forEach((stop) => stop())
  }, [server, client, projectID, live])

  return { projectID, worktrees: projectID ? inventory.data : undefined }
}
