// SSH work that runs for the whole window (#584), ported from the Solid window's SshDialogs and
// SshRestore: a host's prompt opens its dialog when no other dialog is up, and saved hosts that
// were disconnected start again in the background once per window. Mount once, app-wide.

import { useEffect, useRef } from "react"
import { useDialog } from "../../dialog/dialogs"
import { useStore } from "../../react/use-store"
import { useSshState } from "./context"
import { SshDialog } from "./dialog"

export function SshBackground() {
  const { ssh, items } = useSshState()
  const dialog = useDialog()
  const open = useStore(dialog.entries, (entries) => entries.length > 0)
  const restored = useRef(new Set<string>())

  useEffect(() => {
    const item = ssh.next()
    if (!item || open) return
    ssh.opened(item.config.id)
    dialog.show((close) => <SshDialog config={item.config} promptOnly onClose={close} />)
  })

  useEffect(() => {
    items.forEach((item) => {
      if (!item.saved || restored.current.has(item.config.id)) return
      // Active hosts are marked too, so a later manual disconnect is respected.
      restored.current.add(item.config.id)
      if (item.stage === "disconnected") void ssh.restore(item.config)
    })
  }, [items])

  return null
}
