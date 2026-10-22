// Settings' live inventory (#584): the servers with their WSL/SSH state, and each server's projects.

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import type { Server } from "../core/servers"
import { useCore, useServerData, useServerProjects } from "../react/core"
import { useStore } from "../react/use-store"
import { useSshServers, useWslState } from "../servers/remote-state"
import { settingsProjects, settingsServers, type SettingsProject, type SettingsServer } from "./inventory"

export function useSettingsServers(): SettingsServer[] {
  // Hidden servers are listed too: their menu shows them again.
  const servers = useStore(useCore().all, (list) => list)
  const wsl = useWslState()
  const ssh = useSshServers()
  return useMemo(() => settingsServers(servers, wsl?.servers ?? [], ssh), [servers, wsl, ssh])
}

/** The projects settings shows for a server; the server's project list is read once on mount. */
export function useSettingsProjects(server: Server): SettingsProject[] {
  const projects = useServerProjects(server)
  const known = useServerData(server, (state) => state.project.info)
  useEffect(() => {
    void server.data.project.sync().catch(() => undefined)
  }, [server])
  return useMemo(
    () => settingsProjects({ open: projects.list, known: Object.values(known), closed: projects.recentlyClosed }),
    [projects.list, known, projects.recentlyClosed],
  )
}

export type SettingsServerSnapshot = SettingsServer & { connected: boolean; projects: SettingsProject[] }

/** Every server with its connection state and projects, for the settings search. */
export function useSettingsServerSnapshots(servers: readonly SettingsServer[]): SettingsServerSnapshot[] {
  const core = useCore()
  const live = servers.map((entry) => (entry.connection ? core.registry.ensure(entry.connection) : undefined))
  useEffect(() => {
    live.forEach((server) => void server?.data.project.sync().catch(() => undefined))
  }, [live.map((server) => server?.key ?? "").join("\n")])
  const cache = useRef<{ inputs: unknown[]; value: SettingsServerSnapshot[] } | undefined>(undefined)
  const read = () => {
    const state = core.serverState.store.get()
    const inputs: unknown[] = [
      servers,
      state,
      ...live.flatMap((server) => [server?.data.state.get(), server?.connection.get()]),
    ]
    const cached = cache.current
    if (
      cached &&
      cached.inputs.length === inputs.length &&
      cached.inputs.every((item, index) => item === inputs[index])
    )
      return cached.value
    const value = servers.map((entry, index): SettingsServerSnapshot => {
      const server = live[index]
      if (!server) return { ...entry, connected: false, projects: [] }
      const scope = core.scope(server.key)
      return {
        ...entry,
        connected: server.connection.get().status === "connected",
        projects: settingsProjects({
          open: state.projects[scope] ?? [],
          known: Object.values(server.data.state.get().project.info),
          closed: state.recentlyClosed[scope] ?? [],
        }),
      }
    })
    cache.current = { inputs, value }
    return value
  }
  const subscribe = (listener: () => void) => {
    const stops = [
      core.serverState.store.subscribe(listener),
      ...live.flatMap((server) =>
        server ? [server.data.state.subscribe(listener), server.connection.subscribe(listener)] : [],
      ),
    ]
    return () => stops.forEach((stop) => stop())
  }
  return useSyncExternalStore(subscribe, read, read)
}

export type { SettingsProject, SettingsServer }
