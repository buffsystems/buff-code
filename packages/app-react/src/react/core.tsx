// The core layer as React sees it (#584): one Core per window — the platform, the servers the host
// provides plus the stored ones, their live controllers and the persisted project lists — and
// hooks that subscribe to slices of it with selectors.

import { createContext, use, useEffect, useMemo, type ReactNode } from "react"
import type { ConnectionState } from "../core/connection"
import type { DataState } from "../core/data/state"
import {
  createServerRegistry,
  resolveServerList,
  serverKey,
  serverScope,
  type Server,
  type ServerConnection,
} from "../core/servers"
import { createServerState, type ServerStateValue } from "../core/server-state"
import { combine, createStore } from "../core/store"
import { watchRemoteConnections } from "../servers/connections"
import type { Platform } from "../platform/platform"
import { initialMessageLimit } from "../session/timeline/settings"
import { windowSettings } from "../shell/settings-model"
import { shallowEqual, useStore } from "./use-store"

export type CoreInput = {
  platform: Platform
  /** Servers the host provides: the desktop sidecar, the page's own server. */
  servers: ServerConnection[]
  defaultServer?: string
  /** The provided server that counts as "local" for persistence (the page's own server). */
  canonicalLocalServer?: string
  onError?: (error: unknown) => void
}

export function createCore(input: CoreInput) {
  const serverState = createServerState(input.platform.storage("opencode.global.dat"), input.canonicalLocalServer)
  // A failed event-driven read goes to the host and to whoever shows it (the shell's toast).
  const readFailures = new Set<(error: unknown) => void>()
  const registry = createServerRegistry({
    fetch: input.platform.fetch,
    onError: (error) => {
      input.onError?.(error)
      readFailures.forEach((listener) => listener(error))
    },
    initialMessageLimit: () =>
      initialMessageLimit(windowSettings(input.platform.storage).store.get().general.timelineDetail),
  })
  // The host's servers, plus the desktop app's WSL distros and SSH hosts as they come and go. The
  // watch lives as long as the window: dispose also runs on StrictMode's rehearsed unmount.
  const provided = createStore<ServerConnection[]>(input.servers)
  watchRemoteConnections(input.platform, (remote) => provided.set(() => [...input.servers, ...remote]))
  /** Every server, hidden ones too (settings list them to show them again). */
  const all = combine(provided, serverState.store, (servers, state) =>
    resolveServerList({ provided: servers, stored: state.list }),
  )
  const visible = combine(all, serverState.store, (servers, state) =>
    servers.filter((conn) => !state.hidden[serverKey(conn)]),
  )
  return {
    ...input,
    serverState,
    registry,
    provided,
    all,
    visible,
    scope: (key: string) => serverScope(key, input.canonicalLocalServer),
    /** Hear every failed event-driven read of any server; returns the unsubscribe. */
    onReadFailure(listener: (error: unknown) => void) {
      readFailures.add(listener)
      return () => void readFailures.delete(listener)
    },
    dispose: () => registry.dispose(),
  }
}

export type Core = ReturnType<typeof createCore>

const CoreContext = createContext<Core | undefined>(undefined)

export function CoreProvider(props: { core: Core; children?: ReactNode }) {
  const core = props.core
  const servers = useStore(core.visible, (list) => list, shallowEqual)
  // Controllers of servers that left the list stop their streams.
  useEffect(() => core.registry.retain(servers), [core, servers])
  return <CoreContext value={core}>{props.children}</CoreContext>
}

export function useCore() {
  const core = use(CoreContext)
  if (!core) throw new Error("useCore must be used inside CoreProvider")
  return core
}

/** The visible servers, default first. */
export function useServers() {
  const core = useCore()
  const list = useStore(core.visible, (servers) => servers, shallowEqual)
  const first = list.find((conn) => serverKey(conn) === core.defaultServer)
  return first ? [first, ...list.filter((conn) => conn !== first)] : list
}

/** The live controller of a server, created on first use. */
export function useServer(conn: ServerConnection) {
  return useCore().registry.ensure(conn)
}

export function useServerData<Selected>(
  server: Server,
  select: (state: DataState) => Selected,
  equal?: (previous: Selected, next: Selected) => boolean,
) {
  return useStore(server.data.state, select, equal)
}

export function useConnection(server: Server): ConnectionState {
  return useStore(server.connection, (state) => state)
}

/** The projects open on a server, persisted where the Solid window keeps them. */
export function useServerProjects(server: Server) {
  const core = useCore()
  const scope = core.scope(server.key)
  const projects = useMemo(() => core.serverState.projects(scope), [core, scope])
  const list = useStore(core.serverState.store, (state) => state.projects[scope] ?? empty)
  const recentlyClosed = useStore(core.serverState.store, (state) => state.recentlyClosed[scope] ?? none)
  return { ...projects, list, recentlyClosed }
}

const empty: ServerStateValue["projects"][string] = []
const none: string[] = []
