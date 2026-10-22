// «MCPs» (#584), the Solid DialogSelectMcp opened by «Toggle MCPs» (mod+; and /mcp): the MCP
// servers of the session's directory with a search, each a switch that connects or disconnects it
// there; the status and its reason in the words of the settings and of the session details (#444).

import { CommandList, Dialog, DialogBody, Switch, type CommandItem } from "@buff/ui/react"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { useEffect, useState } from "react"
import type { Server } from "../../core/servers"
import { locationKey } from "../../core/data/state"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import { useMcpHost } from "../../new-session/use-mcp"
import { toggleMcp } from "../../new-session/mcp"

export function McpDialog(props: { server: Server; directory: string; onClose: () => void }) {
  const i18n = useI18n()
  const host = useMcpHost()
  const location = { directory: props.directory }
  const [pending, setPending] = useState<string>()
  useEffect(() => {
    void props.server.data.location.mcpServer.sync({ directory: props.directory }).catch(() => undefined)
  }, [props.server, props.directory])
  const servers = useServerData(props.server, (state) => state.location[locationKey(location)]?.mcpServer)
  const list = [...(servers ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const enabled = list.filter((server) => server.status.status === "connected").length

  const toggle = (name: string) => {
    const server = list.find((item) => item.name === name)
    if (!server || server.status.status === "pending" || pending) return
    setPending(name)
    void toggleMcp(
      props.server,
      { name, enabled: server.status.status !== "connected", directory: props.directory },
      host,
    )
      .catch(host.failed)
      .finally(() => setPending(undefined))
  }

  const items: CommandItem[] = list.map((server) => {
    const text = BuffMcp.statusText(server.status, i18n.buff.t)
    return {
      value: server.name,
      label: server.name,
      description: [text.label, text.reason].filter(Boolean).join(" · ") || undefined,
      keywords: [server.status.status],
      hint: (
        // The switch toggles by itself; its click must not also select the row.
        <span onClick={(event) => event.stopPropagation()}>
          <Switch
            data-slot="switch-control"
            aria-label={server.name}
            checked={server.status.status === "connected"}
            disabled={server.status.status === "pending" || pending === server.name}
            onCheckedChange={() => toggle(server.name)}
          />
        </span>
      ),
    }
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={i18n.t("dialog.mcp.title")}
      description={i18n.t("dialog.mcp.description", { enabled, total: list.length })}
      closeLabel={i18n.t("common.close")}
    >
      <DialogBody>
        <CommandList
          items={items}
          label={i18n.t("common.search.placeholder")}
          placeholder={i18n.t("common.search.placeholder")}
          emptyText={i18n.t("dialog.mcp.empty")}
          loading={servers === undefined}
          loadingText={i18n.t("common.loading")}
          autoFocus
          onSelect={(item) => toggle(item.value)}
        />
      </DialogBody>
    </Dialog>
  )
}
