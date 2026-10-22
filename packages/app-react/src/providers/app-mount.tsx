// The providers' commands for the whole window (#584): `buff.signin` (the composer's context chip
// and «no model» bar) and `provider.connect` («Manage models»). Both open the connect dialog on the
// server and directory on screen — the routed session's, the draft's, else the first server.

import { useCommandRegistration } from "../commands/provider"
import { useDialog } from "../dialog/dialogs"
import { useI18n } from "../i18n/provider"
import { useCore, useServers } from "../react/core"
import { useRoute } from "../router/router"
import { serverKey } from "../core/servers"
import { useCurrentTab } from "../shell/tabs/provider"
import type { AppMount } from "../shell/mounts"
import { openBuffSignIn, openConnectProvider } from "./connect/open"

function ProviderCommands() {
  const i18n = useI18n()
  const dialog = useDialog()
  const core = useCore()
  const servers = useServers()
  const route = useRoute()
  const tab = useCurrentTab()
  const target = () => {
    const key = route.name === "session" ? route.serverKey : tab?.type === "draft" ? tab.server : undefined
    const conn = servers.find((item) => serverKey(item) === key) ?? servers[0]
    if (!conn) return undefined
    const server = core.registry.ensure(conn)
    const directory =
      route.name === "session"
        ? server.data.session.get(route.sessionID)?.location.directory
        : tab?.type === "draft"
          ? tab.directory
          : undefined
    return { server, directory }
  }
  useCommandRegistration("providers", () => [
    {
      id: "buff.signin",
      title: i18n.buff.t("Sign in to Buff"),
      category: "Buff",
      onSelect: () => {
        const input = target()
        if (input) openBuffSignIn(dialog, input)
      },
    },
    {
      id: "provider.connect",
      title: i18n.t("command.provider.connect"),
      category: i18n.t("command.category.provider"),
      onSelect: () => {
        const input = target()
        if (input) openConnectProvider(dialog, input)
      },
    },
  ])
  return null
}

export default { id: "providers-commands", component: ProviderCommands } satisfies AppMount
