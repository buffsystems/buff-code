// A saved SSH host's «More options» (#584), ported from the Solid window's ssh/menu.tsx: connect
// or authenticate, the default server, delete.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@buff/ui/react"
import { Ellipsis } from "lucide-react"
import { useI18n } from "../../i18n/provider"
import type { ServerActions } from "../registry/actions"
import { useSshState } from "./context"

export function SshMenu(props: { id: string; actions: ServerActions }) {
  const i18n = useI18n()
  const { ssh } = useSshState()
  const item = ssh.item(props.id)
  if (!item) return null
  const key = `ssh:${props.id}`
  const defaults = props.actions.defaults
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton icon={Ellipsis} size="xs" aria-label={i18n.t("common.moreOptions")} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{i18n.t("ssh.server.menu.label")}</DropdownMenuLabel>
          {item.stage !== "ready" && (
            <DropdownMenuItem disabled={ssh.pending(props.id)} onSelect={() => ssh.connect(item.config)}>
              {i18n.t(item.stage === "authentication" ? "ssh.authenticate" : "ssh.connect")}
            </DropdownMenuItem>
          )}
          {defaults.available && defaults.key !== key && (
            <DropdownMenuItem onSelect={() => void defaults.set(key)}>
              {i18n.t("dialog.server.menu.default")}
            </DropdownMenuItem>
          )}
          {defaults.available && defaults.key === key && (
            <DropdownMenuItem onSelect={() => void defaults.set(null)}>
              {i18n.t("dialog.server.menu.defaultRemove")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => void props.actions.remove(key)}>
            {i18n.t("dialog.server.menu.delete")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
