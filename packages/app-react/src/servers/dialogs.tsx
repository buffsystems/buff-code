// The servers' dialogs (#584), each loaded when first opened: an HTTP server to add or edit, an
// SSH host, a WSL distro.

import { lazy, Suspense } from "react"
import { serverKey } from "../core/servers"
import type { DialogStack } from "../dialog/dialogs"
import { useCore } from "../react/core"
import { useStore } from "../react/use-store"

const ServerDialog = lazy(() => import("./connect/dialog").then((module) => ({ default: module.ServerDialog })))
const SshDialog = lazy(() => import("./ssh/dialog").then((module) => ({ default: module.SshDialog })))
const WslAddDialog = lazy(() => import("./wsl/dialog").then((module) => ({ default: module.WslAddDialog })))

/** Add an HTTP server, or edit the one with key `server`; `onSaved` gets the saved server's key. */
export function openServerDialog(
  dialog: DialogStack,
  input: { mode: "add" | "edit"; server?: string; onSaved?: (key: string) => void },
) {
  dialog.show((close) => (
    <Suspense>
      <EditServer {...input} onClose={close} />
    </Suspense>
  ))
}

function EditServer(props: {
  mode: "add" | "edit"
  server?: string
  onSaved?: (key: string) => void
  onClose: () => void
}) {
  const core = useCore()
  const all = useStore(core.all, (list) => list)
  const server = all.find((conn) => serverKey(conn) === props.server)
  const http = server?.type === "http" ? server : undefined
  if (props.mode === "edit" && !http) return null
  return (
    <ServerDialog
      mode={props.mode}
      server={http}
      onSaved={(saved) => props.onSaved?.(serverKey(saved))}
      onClose={props.onClose}
    />
  )
}

export function openSshDialog(dialog: DialogStack) {
  dialog.show((close) => (
    <Suspense>
      <SshDialog onClose={close} />
    </Suspense>
  ))
}

export function openWslDialog(dialog: DialogStack) {
  dialog.show((close) => (
    <Suspense>
      <WslAddDialog onClose={close} />
    </Suspense>
  ))
}
