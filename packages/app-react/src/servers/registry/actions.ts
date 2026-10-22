// What a server row can do (#584), ported from the Solid window's registry/controller.ts: edit an
// HTTP server, make a server the default, hide the desktop's own one from the project list, remove
// a server the person added (a WSL distro or SSH host is forgotten by the desktop app too).

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import { serverKey, type ServerConnection } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useCore, useServers } from "../../react/core"
import { useStore } from "../../react/use-store"
import { showToast } from "../../shell/notifications/toast"
import { builtinServer, createServerRegistryActions } from "./registry"

const DEFAULT_KEY = ["default-server"]

export function useServerActions() {
  const core = useCore()
  const platform = usePlatform()
  const i18n = useI18n()
  const client = useQueryClient()
  const visible = useServers()
  const hidden = useStore(core.serverState.store, (state) => state.hidden)
  const registry = useMemo(
    () => createServerRegistryActions({ state: core.serverState, provided: core.servers }),
    [core],
  )
  const failed = (error: unknown) =>
    showToast({
      variant: "error",
      title: i18n.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })
  const available = !!platform.getDefaultServer && !!platform.setDefaultServer
  const stored = useQuery({
    queryKey: DEFAULT_KEY,
    enabled: available,
    queryFn: () => Promise.resolve(platform.getDefaultServer?.()).then((key) => key ?? null),
  })
  const setDefault = async (key: string | null) => {
    try {
      await platform.setDefaultServer?.(key)
      client.setQueryData(DEFAULT_KEY, key)
    } catch (error) {
      failed(error)
    }
  }
  const remove = async (key: string) => {
    try {
      if (key.startsWith("wsl:")) await platform.wslServers?.removeServer(key)
      if (key.startsWith("ssh:")) await platform.sshServers?.forget(key.slice(4))
      registry.remove(key)
      if ((await platform.getDefaultServer?.()) === key) await setDefault(null)
    } catch (error) {
      failed(error)
    }
  }
  return {
    registry,
    defaults: { available, key: available ? (stored.data ?? null) : null, set: setDefault },
    remove,
    canRemove: registry.canRemove,
    isHidden: (key: string) => hidden[key] ?? false,
    setHidden: registry.setHidden,
    /** The desktop's own server can be hidden while another server stays visible. */
    canHide: (conn: ServerConnection) => visible.length > 1 && builtinServer(conn),
    key: serverKey,
  }
}

export type ServerActions = ReturnType<typeof useServerActions>
