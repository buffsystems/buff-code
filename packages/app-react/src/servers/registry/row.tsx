// A server's state mark and its «More options» menu (#584), ported from the Solid window's
// registry/row.tsx (ServerHealthIndicator) and row-menu.tsx (ServerRowMenu).

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Spinner,
  StatusDot,
} from "@buff/ui/react"
import { Ellipsis, Lock, TriangleAlert } from "lucide-react"
import type { ServerConnection } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useConnection, useServer } from "../../react/core"
import { SshMenu } from "../ssh/menu"
import type { ServerActions } from "./actions"
import type { ServerHealth } from "./health"
import { builtinServer } from "./registry"

export function ServerHealthIndicator(props: {
  health?: ServerHealth
  connecting?: boolean
  authenticationRequired?: boolean
}) {
  const i18n = useI18n()
  if (props.authenticationRequired)
    return (
      <span role="status" aria-label={i18n.t("ssh.stage.authentication")} className="inline-flex shrink-0">
        <Lock aria-hidden className="size-3.5 text-muted-foreground" />
      </span>
    )
  if (props.connecting || props.health?.checking) return <Spinner size={12} label={i18n.t("ssh.stage.connecting")} />
  if (props.health?.incompatible) return <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
  const tone = props.health === undefined ? "neutral" : props.health.healthy ? "ok" : "crit"
  return <StatusDot tone={tone} />
}

/** The mark of a server the window is connected to: its live connection. */
export function LiveServerHealth(props: { conn: ServerConnection }) {
  const server = useServer(props.conn)
  const connection = useConnection(server)
  if (connection.status === "connecting") return <ServerHealthIndicator connecting />
  return <ServerHealthIndicator health={{ healthy: connection.status === "connected" }} />
}

export function ServerRowMenu(props: {
  server: ServerConnection
  actions: ServerActions
  onEdit: (server: Extract<ServerConnection, { type: "http" }>) => void
}) {
  const i18n = useI18n()
  const server = props.server
  if (server.type === "ssh" && server.id) return <SshMenu id={server.id} actions={props.actions} />
  const key = props.actions.key(server)
  const defaults = props.actions.defaults
  const isDefault = defaults.key === key
  const hidden = props.actions.isHidden(key)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton icon={Ellipsis} size="xs" aria-label={i18n.t("common.moreOptions")} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{i18n.t("settings.section.server")}</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={builtinServer(server) || server.type !== "http"}
            onSelect={() => server.type === "http" && props.onEdit(server)}
          >
            {i18n.t("dialog.server.menu.edit")}
          </DropdownMenuItem>
          {defaults.available && !isDefault && (
            <DropdownMenuItem onSelect={() => void defaults.set(key)}>
              {i18n.t("dialog.server.menu.default")}
            </DropdownMenuItem>
          )}
          {defaults.available && isDefault && (
            <DropdownMenuItem onSelect={() => void defaults.set(null)}>
              {i18n.t("dialog.server.menu.defaultRemove")}
            </DropdownMenuItem>
          )}
          {hidden && (
            <DropdownMenuItem onSelect={() => props.actions.setHidden(key, false)}>
              {i18n.t("dialog.server.menu.show")}
            </DropdownMenuItem>
          )}
          {!hidden && props.actions.canHide(server) && (
            <DropdownMenuItem onSelect={() => props.actions.setHidden(key, true)}>
              {i18n.t("dialog.server.menu.hide")}
            </DropdownMenuItem>
          )}
          {props.actions.canRemove(key) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => void props.actions.remove(key)}>
                {i18n.t("dialog.server.menu.remove")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
