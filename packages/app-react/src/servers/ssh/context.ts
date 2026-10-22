// The window's SSH hosts and their connection attempts (#584), ported from the Solid window's
// ssh/context.tsx: one controller per platform, over the platform's SSH state.

import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import type { Platform } from "../../platform/platform"
import { useStore } from "../../react/use-store"
import { showToast } from "../../shell/notifications/toast"
import { remoteServers } from "../remote-state"
import { createSshController, type SshController } from "./controller"

const controllers = new WeakMap<Platform, { controller: SshController; failed: { title: string } }>()

export function useSsh() {
  const platform = usePlatform()
  const i18n = useI18n()
  const existing = controllers.get(platform)
  if (existing) {
    existing.failed.title = i18n.t("common.requestFailed")
    return existing.controller
  }
  const remote = remoteServers(platform)
  const failed = { title: i18n.t("common.requestFailed") }
  const controller = createSshController({
    items: remote.ssh,
    api: platform.sshServers,
    refresh: async () => {
      const state = await platform.sshServers?.getState()
      if (state) remote.ssh.set(() => state.servers)
    },
    error: () => showToast({ variant: "error", title: failed.title }),
  })
  controllers.set(platform, { controller, failed })
  return controller
}

/** Re-render on every change of the hosts or of their attempts. */
export function useSshState() {
  const ssh = useSsh()
  const platform = usePlatform()
  const items = useStore(remoteServers(platform).ssh, (value) => value)
  const attempts = useStore(ssh.attempts, (value) => value)
  return { ssh, items, attempts }
}
