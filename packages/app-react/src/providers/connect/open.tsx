// Entries to connecting providers (#584): the provider list, or straight to Buff's sign-in
// (#401) — every place that offers it (settings, the model picker before sign-in, the introduction,
// the context chip) opens the same dialog. Loaded on first use.

import { BUFF_PROVIDER } from "@opencode/app/react-reuse/buff-providers"
import { lazy, Suspense } from "react"
import type { Server } from "../../core/servers"
import type { DialogStack } from "../../dialog/dialogs"

const Connect = lazy(() => import("./dialog").then((module) => ({ default: module.DialogConnectProvider })))

export function openConnectProvider(
  dialog: DialogStack,
  input: { server: Server; directory?: string; provider?: string; onClose?: () => void },
) {
  return dialog.show((close) => (
    <Suspense>
      <Connect
        server={input.server}
        directory={input.directory}
        provider={input.provider}
        onClose={() => {
          close()
          input.onClose?.()
        }}
      />
    </Suspense>
  ))
}

/** Sign in to Buff: the connector address, the code, the wait. */
export function openBuffSignIn(
  dialog: DialogStack,
  input: { server: Server; directory?: string; onClose?: () => void },
) {
  return openConnectProvider(dialog, { ...input, provider: BUFF_PROVIDER })
}
