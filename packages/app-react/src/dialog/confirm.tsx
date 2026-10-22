// Asking before a change that cannot be undone (#584): a ConfirmDialog on the window's dialog
// stack, as a promise of the answer.

import { ConfirmDialog } from "@buff/ui/react"
import type { ReactNode } from "react"
import type { DialogStack } from "./dialogs"

export function confirm(
  dialog: DialogStack,
  input: { title: string; text: ReactNode; action: string; cancel: string; danger?: boolean },
) {
  return new Promise<boolean>((resolve) => {
    dialog.show((close) => (
      <ConfirmDialog
        open
        title={input.title}
        message={input.text}
        confirmLabel={input.action}
        cancelLabel={input.cancel}
        danger={input.danger}
        onCancel={() => {
          close()
          resolve(false)
        }}
        onConfirm={() => {
          close()
          resolve(true)
        }}
      />
    ))
  })
}
