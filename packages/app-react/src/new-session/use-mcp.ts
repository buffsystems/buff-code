// The window's side of an MCP switch (#584): its words, the browser for a sign-in and the toast
// for a failure — for the draft's switches and for an existing session's, which apply at once.

import { useState } from "react"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { showToast } from "../shell/notifications/toast"
import type { McpControls } from "../summary/server-panel"
import { toggleMcp, type McpHost } from "./mcp"

export function useMcpHost(): McpHost {
  const i18n = useI18n()
  const platform = usePlatform()
  return {
    text: {
      unavailable: (name) => i18n.t("session.summary.mcp.unavailable", { name }),
      signIn: (name) => i18n.t("session.summary.mcp.signInBeforeSend", { name }),
      notReady: (name) => i18n.t("session.summary.mcp.notReady", { name }),
      interactiveForm: (name) => i18n.t("mcp.auth.interactiveForm", { name }),
    },
    openExternal: (url) => platform.openExternal(url),
    failed: (error) =>
      showToast({
        variant: "error",
        title: i18n.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }
}

/** An existing session's switches, as the Solid useMcpToggle: each applies in its directory at once. */
export function useLiveMcp(server: Server, directory: string): McpControls {
  const host = useMcpHost()
  const [pending, setPending] = useState(false)
  return {
    states: {},
    preview: false,
    pending,
    change(name, enabled) {
      if (pending) return
      setPending(true)
      void toggleMcp(server, { name, enabled, directory }, host)
        .catch(host.failed)
        .finally(() => setPending(false))
    },
  }
}
