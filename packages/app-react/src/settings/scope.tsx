// The server (and project) a settings page reads (#584), ported from the Solid window's
// SettingsServerDataScope: its connection, its live controller and the directory its catalogs are
// read in — the project for project pages, else where the Buff context was chosen last (#466).

import { BuffContext } from "@opencode/schema/buff-context"
import { useQuery } from "@tanstack/react-query"
import { createContext, use, type ReactNode } from "react"
import type { Server, ServerConnection } from "../core/servers"
import { useConnection, useServer } from "../react/core"
import { useLocation } from "../react/location"
import type { SettingsProject } from "./inventory"

export type SettingsScope = {
  conn: ServerConnection
  server: Server
  /** The directory the server's catalogs (models, MCPs, skills) are read in; undefined: global. */
  directory?: string
  project?: SettingsProject
}

const ScopeContext = createContext<SettingsScope | undefined>(undefined)

export function SettingsScopeProvider(props: {
  conn: ServerConnection
  project?: SettingsProject
  children?: ReactNode
}) {
  const server = useServer(props.conn)
  const last = useLastDirectory(server)
  const directory = props.project?.worktree ?? last
  // A project's pages show its place, as the Solid window's LocationProvider around them: its
  // catalogs and its worktree inventory are read (and discovered) while they are open.
  useLocation(server, props.project?.worktree, !!props.project)
  return (
    <ScopeContext value={{ conn: props.conn, server, directory, project: props.project }}>
      {props.children}
    </ScopeContext>
  )
}

export function useSettingsScope() {
  const scope = use(ScopeContext)
  if (!scope) throw new Error("useSettingsScope must be used inside SettingsScopeProvider")
  return scope
}

// Read on every opening of settings: the choice may have changed while they were closed.
function useLastDirectory(server: Server) {
  const connection = useConnection(server)
  const query = useQuery({
    queryKey: ["settings-last-directory", server.key],
    enabled: connection.status === "connected",
    queryFn: () =>
      server
        .api()
        .rpc(BuffContext.Rpc)
        .lastDirectory()
        .catch(() => null),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  return query.data ?? undefined
}
