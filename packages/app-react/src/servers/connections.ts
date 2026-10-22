// The desktop app's WSL distros and SSH hosts as servers of the window (#584), ported from the
// Solid desktop renderer's wsl/connections.ts and ssh/connections.ts: a ready distro is a sidecar
// server, a saved SSH host is a server whose tunnel address the desktop app resolves on reconnect.

import { sshHostname, sshName, type SshItem, type SshPlatform } from "@opencode/app/ssh"
import type { WslServersState } from "@opencode/app/wsl/types"
import type { ServerConnection } from "../core/servers"
import type { Platform } from "../platform/platform"
import { remoteServers } from "./remote-state"

export function readyWslConnections(state: WslServersState | undefined): ServerConnection[] {
  return (state?.servers ?? []).flatMap((item): ServerConnection[] => {
    if (item.runtime.kind !== "ready") return []
    return [
      {
        type: "sidecar",
        variant: "wsl",
        distro: item.config.distro,
        displayName: item.config.distro,
        http: { url: item.runtime.url, password: item.runtime.password ?? undefined },
      },
    ]
  })
}

const pending = { url: "http://127.0.0.1:0" }

/** Saved SSH hosts; a host keeps its connection object while its address stays the same. */
export function createSshConnections(api: Pick<SshPlatform, "resolve"> | undefined) {
  const known = new Map<string, { url: string; name: string; conn: ServerConnection }>()
  const resolve = (id: string) => async (signal: AbortSignal) => {
    for (;;) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError")
      const http = await api?.resolve(id).catch(() => null)
      if (http) return http
      await new Promise((done) => setTimeout(done, 3000))
    }
  }
  return (items: readonly SshItem[]) => {
    const saved = items.filter((item) => item.saved)
    const ids = new Set(saved.map((item) => item.config.id))
    known.forEach((_, id) => !ids.has(id) && known.delete(id))
    return saved.map((item) => {
      const http = item.http ?? pending
      const name = sshName(item.config)
      const existing = known.get(item.config.id)
      if (existing && existing.url === http.url && existing.name === name) return existing.conn
      const conn: ServerConnection = {
        type: "ssh",
        id: item.config.id,
        host: sshHostname(item.config.target),
        displayName: name,
        http,
        reconnect: resolve(item.config.id),
      }
      known.set(item.config.id, { url: http.url, name, conn })
      return conn
    })
  }
}

/** Follow the platform's WSL and SSH servers; `update` gets them whenever they change. */
export function watchRemoteConnections(platform: Platform, update: (servers: ServerConnection[]) => void) {
  if (!platform.wslServers && !platform.sshServers) return () => undefined
  const remote = remoteServers(platform)
  const ssh = createSshConnections(platform.sshServers)
  const publish = () => update([...readyWslConnections(remote.wsl.get()), ...ssh(remote.ssh.get())])
  const stops = [remote.wsl.subscribe(publish), remote.ssh.subscribe(publish)]
  publish()
  return () => stops.forEach((stop) => stop())
}
