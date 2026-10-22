// What settings lists (#584), ported from the Solid window's servers/inventory.ts: every server —
// the window's connections, plus WSL distros and saved SSH hosts that are not connected — and the
// projects of a server: the ones open in the window, then the ones it knows that were not closed.

import { pathKey } from "@opencode/app/react-reuse/path-key"
import { sshName, type SshItem } from "@opencode/app/ssh"
import type { WslServerItem } from "@opencode/app/wsl/types"
import type { Project } from "@opencode/client/promise"
import { getFilename } from "@opencode/util/path"
import { serverKey, serverName, type ServerConnection } from "../core/servers"
import type { LocalProject } from "../core/server-state"

export type SettingsServer = {
  key: string
  name: string
  /** The connection settings can read; absent while a WSL or SSH server is not ready. */
  connection?: ServerConnection
  wsl?: WslServerItem
  ssh?: SshItem
}

export type SettingsProject = Partial<Omit<Project, "time">> & {
  worktree: string
  expanded: boolean
  time?: Project["time"]
}

export function settingsServers(
  connections: readonly ServerConnection[],
  wsl: readonly WslServerItem[],
  ssh: readonly SshItem[],
): SettingsServer[] {
  const configured = new Map(wsl.map((item) => [item.config.id, item]))
  const saved = new Map(ssh.filter((item) => item.saved).map((item) => [`ssh:${item.config.id}`, item]))
  const connected = new Set(connections.map(serverKey))
  return [
    ...connections.map((connection): SettingsServer => {
      const key = serverKey(connection)
      const item = configured.get(key)
      const remote = saved.get(key)
      const blocked = (item && item.runtime.kind !== "ready") || (remote && remote.stage !== "ready")
      return {
        key,
        name: item?.config.distro ?? (remote ? sshName(remote.config) : serverName(connection) || key),
        connection: blocked ? undefined : connection,
        wsl: item,
        ssh: remote,
      }
    }),
    ...wsl
      .filter((item) => !connected.has(item.config.id))
      .map((item): SettingsServer => ({ key: item.config.id, name: item.config.distro, wsl: item })),
    ...ssh
      .filter((item) => item.saved && !connected.has(`ssh:${item.config.id}`))
      .map((item): SettingsServer => ({ key: `ssh:${item.config.id}`, name: sshName(item.config), ssh: item })),
  ]
}

/** A project the server knows, in the shape of an open one. */
export function knownProject(project: Project): SettingsProject {
  return { ...project, worktree: project.canonical, expanded: false }
}

export function settingsProjects(input: {
  open: readonly LocalProject[]
  known: readonly Project[]
  closed: readonly string[]
}): SettingsProject[] {
  const byPath = new Map(input.known.map((project) => [pathKey(project.canonical), project]))
  const tracked = input.open.map((project): SettingsProject => {
    const info = byPath.get(pathKey(project.worktree))
    return info ? { ...knownProject(info), ...project } : project
  })
  const paths = new Set(tracked.map((project) => pathKey(project.worktree)))
  const closed = new Set(input.closed.map(pathKey))
  return [
    ...tracked,
    ...input.known
      .filter((project) => !paths.has(pathKey(project.canonical)) && !closed.has(pathKey(project.canonical)))
      .map(knownProject),
  ]
}

/** The name a project shows: its own, else its folder's (the Solid window's displayName). */
export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree) || project.worktree
