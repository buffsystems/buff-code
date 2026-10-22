// «Add server» (#584), ported from the Solid window's AddServerMenu: a button for an HTTP server;
// on the desktop a menu that also offers an SSH host and a WSL distro.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@buff/ui/react"
import { Plus } from "lucide-react"
import { useDialog } from "../dialog/dialogs"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { openServerDialog, openSshDialog, openWslDialog } from "./dialogs"

/** Open the dialog that adds an HTTP server; `onSaved` gets the new server's key. */
export function useAddServer(onSaved?: (key: string) => void) {
  const dialog = useDialog()
  return () => openServerDialog(dialog, { mode: "add", onSaved })
}

export function AddServerMenu(props: { onAddServer: () => void; compact?: boolean }) {
  const i18n = useI18n()
  const platform = usePlatform()
  const dialog = useDialog()
  const label = i18n.t("dialog.server.add.button")
  const trigger = props.compact ? (
    <IconButton
      icon={Plus}
      size="xs"
      aria-label={label}
      onClick={platform.wslServers || platform.sshServers ? undefined : props.onAddServer}
    />
  ) : (
    <Button
      variant="ghost"
      size="sm"
      leadingIcon={Plus}
      onClick={platform.wslServers || platform.sshServers ? undefined : props.onAddServer}
    >
      {label}
    </Button>
  )
  if (!platform.wslServers && !platform.sshServers) return trigger
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={props.onAddServer}>{label}</DropdownMenuItem>
        {platform.sshServers && (
          <DropdownMenuItem onSelect={() => openSshDialog(dialog)}>{i18n.t("ssh.add")}</DropdownMenuItem>
        )}
        {platform.wslServers && (
          <DropdownMenuItem onSelect={() => openWslDialog(dialog)}>{i18n.t("wsl.server.add")}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
