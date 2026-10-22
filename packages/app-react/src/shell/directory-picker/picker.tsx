// Asking for a project folder (#584), the Solid useDirectoryPicker: the desktop's native picker for
// its own local server, the in-app picker over the server's folders otherwise.

import type { ServerConnection } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useCore } from "../../react/core"
import { DirectoryPickerDialog } from "./dialog"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

/** The desktop's own server: its native picker sees the same disk. */
export function nativePickerServer(conn: ServerConnection) {
  if (conn.type === "sidecar") return conn.variant === "base"
  if (conn.type !== "http") return false
  try {
    return LOCAL_HOSTS.has(new URL(conn.http.url).hostname)
  } catch {
    return false
  }
}

export function useDirectoryPicker() {
  const platform = usePlatform()
  const dialog = useDialog()
  const core = useCore()
  const i18n = useI18n()
  return async (conn: ServerConnection, options: { multiple?: boolean } = {}): Promise<string[]> => {
    const title = i18n.t("command.project.open")
    if (platform.platform === "desktop" && platform.openDirectoryPickerDialog && nativePickerServer(conn)) {
      const result = await platform.openDirectoryPickerDialog({ title, multiple: options.multiple })
      return !result ? [] : Array.isArray(result) ? result : [result]
    }
    const server = core.registry.ensure(conn)
    return new Promise((resolve) => {
      dialog.show((close) => (
        <DirectoryPickerDialog
          server={server}
          title={title}
          onSelect={(path) => {
            close()
            resolve(path ? [path] : [])
          }}
        />
      ))
    })
  }
}
