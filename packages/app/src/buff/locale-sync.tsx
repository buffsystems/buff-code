import { createEffect, on } from "solid-js"
import { BuffLocale } from "@opencode/schema/buff-locale"
import { useServerSDK } from "@/runtime/server/client"
import { useBuffText } from "./i18n"
import { ServerScope } from "./server-scope"
import { installDiffsText } from "./diffs-text"

/** Язык окна — службе Buff (#472): по нему говорят консоль и строки ядра. */
function Sync() {
  const sdk = useServerSDK()
  const { locale } = useBuffText()
  createEffect(
    on(
      () => [locale(), sdk.connection.status()] as const,
      ([value, status]) => {
        if (status === "connected") void sdk.api.rpc(BuffLocale.Rpc).set(value).catch(() => undefined)
      },
    ),
  )
  return null
}

export function BuffLocaleSync() {
  const { locale } = useBuffText()
  installDiffsText(locale)
  return (
    <ServerScope>
      <Sync />
    </ServerScope>
  )
}
