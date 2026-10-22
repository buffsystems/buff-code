// The desktop app's WSL and SSH servers as stores (#584): the platform publishes their state, the
// settings inventory, the server pages and the dialogs read it. One store per platform object.

import type { SshItem } from "@opencode/app/ssh"
import type { WslServersState } from "@opencode/app/wsl/types"
import { createStore, type Store } from "../core/store"
import type { Platform } from "../platform/platform"
import { usePlatform } from "../platform/context"
import { useStore } from "../react/use-store"

type Remote = { wsl: Store<WslServersState | undefined>; ssh: Store<readonly SshItem[]> }

const remotes = new WeakMap<Platform, Remote>()

/** Start following the platform's WSL and SSH state; the stores stay empty on the web. */
export function remoteServers(platform: Platform): Remote {
  const existing = remotes.get(platform)
  if (existing) return existing
  const remote: Remote = {
    wsl: createStore<WslServersState | undefined>(undefined),
    ssh: createStore<readonly SshItem[]>([]),
  }
  remotes.set(platform, remote)
  const wsl = platform.wslServers
  if (wsl) {
    wsl.subscribe((event) => remote.wsl.set(() => event.state))
    void wsl
      .getState()
      .then((state) => remote.wsl.set((current) => current ?? state))
      .catch(() => undefined)
  }
  const ssh = platform.sshServers
  if (ssh) {
    ssh.subscribe((state) => remote.ssh.set(() => state.servers))
    void ssh
      .getState()
      .then((state) => remote.ssh.set((current) => (current.length ? current : state.servers)))
      .catch(() => undefined)
  }
  return remote
}

export function useWslState() {
  return useStore(remoteServers(usePlatform()).wsl, (state) => state)
}

export function useSshServers() {
  return useStore(remoteServers(usePlatform()).ssh, (state) => state)
}
