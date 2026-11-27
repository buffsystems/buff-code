// «Подключения в этом чате» (#972, R13-07): a connection taken out of one chat and left in the
// others. The engine keeps the choice and enforces it — the model does not see the connection's
// tools here, a call to them is refused; this is the window's switch for it. Turning a connection
// on or off for the whole folder stays in its own dialog (/mcp).

import { CommandList, Dialog, DialogBody, Switch, type CommandItem } from "@buff/ui/react"
import { BuffChatConnections } from "@opencode/schema/buff-chat-connections"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { useEffect, useState } from "react"
import { locationKey } from "../core/data/state"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { useServerData } from "../react/core"
import { showToast } from "../shell/notifications/toast"

export function ChatConnectionsDialog(props: {
  server: Server
  directory: string
  sessionID: string
  onClose: () => void
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const { server, directory, sessionID } = props
  const [off, setOff] = useState<readonly string[]>()
  const [pending, setPending] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const current = { cancelled: false }
    void server.data.location.mcpServer.sync({ directory }).catch(() => undefined)
    server
      .api()
      .rpc(BuffChatConnections.Rpc)
      .get({ sessionID })
      .then((result) => !current.cancelled && setOff(result.off))
      .catch(() => !current.cancelled && setFailed(true))
    return () => {
      current.cancelled = true
    }
  }, [server, directory, sessionID])
  const servers = useServerData(server, (state) => state.location[locationKey({ directory })]?.mcpServer)
  const list = [...(servers ?? [])].sort((a, b) => a.name.localeCompare(b.name))

  const toggle = (name: string) => {
    if (!off || pending) return
    const on = off.includes(name)
    setPending(name)
    server
      .api()
      .rpc(BuffChatConnections.Rpc)
      .change({ sessionID, server: name, on })
      .then((result) => setOff(result.off))
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setPending(undefined))
  }

  const items: CommandItem[] = (failed ? [] : list).map((item) => {
    const connected = item.status.status === "connected"
    const here = connected && !(off ?? []).includes(item.name)
    const status = BuffMcp.statusText(item.status, t)
    return {
      value: item.name,
      label: item.name,
      // A connection that does not work at all says why; a working one — whether this chat uses it.
      description: connected
        ? here
          ? t("Used in this chat")
          : t("Off in this chat")
        : [status.label, status.reason].filter(Boolean).join(" · ") || undefined,
      hint: (
        <span onClick={(event) => event.stopPropagation()}>
          <Switch
            data-slot="switch-control"
            aria-label={item.name}
            checked={here}
            disabled={!connected || !off || pending === item.name}
            onCheckedChange={() => toggle(item.name)}
          />
        </span>
      ),
    }
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={t("Connections in this chat")}
      description={t("A connection turned off here is out of this chat only; the other chats keep it.")}
      closeLabel={i18n.t("common.close")}
    >
      <DialogBody>
        <CommandList
          items={items}
          label={i18n.t("common.search.placeholder")}
          placeholder={i18n.t("common.search.placeholder")}
          emptyText={
            failed
              ? t("The chat's connections could not be read. If this Buff Code has not been updated for long — update it.")
              : t("Nothing is connected yet.")
          }
          loading={!failed && (servers === undefined || off === undefined)}
          loadingText={i18n.t("common.loading")}
          autoFocus
          onSelect={(item) =>
            list.find((s) => s.name === item.value)?.status.status === "connected" && toggle(item.value)
          }
        />
      </DialogBody>
    </Dialog>
  )
}
