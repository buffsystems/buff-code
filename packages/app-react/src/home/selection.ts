// Which server and project Home shows (#584): one selection per window, kept across visits to Home
// and across restarts. The Solid window keeps it inside its layout blob, which this window does
// not own, so it lives under its own key.

import { useEffect } from "react"
import { createPersisted, type Persisted } from "../core/persisted"
import { serverKey, type ServerConnection } from "../core/servers"
import { useCore, useServers, type Core } from "../react/core"
import { useStore } from "../react/use-store"
import type { HomeSelection } from "./model"

const cells = new WeakMap<Core, Persisted<HomeSelection>>()

function selectionCell(core: Core) {
  const existing = cells.get(core)
  if (existing) return existing
  const cell = createPersisted<HomeSelection>({
    storage: core.platform.storage("opencode.global.dat"),
    key: "react.home.selection",
    decode: (raw) => {
      const value: unknown = JSON.parse(raw)
      if (typeof value !== "object" || value === null) return undefined
      const server = "server" in value && typeof value.server === "string" ? value.server : undefined
      const directory = "directory" in value && typeof value.directory === "string" ? value.directory : undefined
      return { server, directory }
    },
    initial: {},
  })
  cells.set(core, cell)
  return cell
}

/** The selection, the server it focuses (the first visible one when none is chosen) and a setter. */
export function useHomeSelection() {
  const core = useCore()
  const servers = useServers()
  const cell = selectionCell(core)
  const value = useStore(cell.store, (state) => state)
  const focused = servers.find((conn) => serverKey(conn) === value.server) ?? servers[0]
  const known = servers.some((conn) => serverKey(conn) === value.server)
  // A selection of a server that left the window falls back to the first one.
  useEffect(() => {
    const first = servers[0]
    if (known || !first) return
    cell.set(() => ({ server: serverKey(first) }))
  }, [known, servers[0] && serverKey(servers[0])])
  return { value, focused, set: (next: HomeSelection) => cell.set(() => next) }
}

/** For screens outside Home (a session header's project menu): show this server or project on Home. */
export function setHomeSelection(core: Core, next: HomeSelection) {
  selectionCell(core).set(() => next)
}

/** Open folders as a server's projects and show the first on Home (Home's add button, «Open project»). */
export function openHomeProjects(core: Core, conn: ServerConnection, directories: string[]) {
  const first = directories[0]
  if (!first) return
  const key = serverKey(conn)
  const projects = core.serverState.projects(core.scope(key))
  directories.forEach((directory) => projects.open(directory))
  projects.touch(first)
  void core.registry
    .ensure(conn)
    .data.project.sync()
    .catch(() => undefined)
  setHomeSelection(core, { server: key, directory: first })
}

/** The project before or after the shown one in Home's order, wrapping around; none shown starts at an end. */
export function adjacentHomeProject(worktrees: string[], current: string | undefined, offset: -1 | 1) {
  const index = current === undefined ? -1 : worktrees.indexOf(current)
  if (index === -1) return offset === 1 ? worktrees[0] : worktrees.at(-1)
  return worktrees[(index + offset + worktrees.length) % worktrees.length]
}
