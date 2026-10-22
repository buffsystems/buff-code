// «Check project hooks and commands» (#457) — the same switch as in getting to know Buff Code,
// ported from the Solid window's buff/trust-policy.tsx.

import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import { BuffTrust } from "@opencode/schema/buff-trust"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { useEffect, useState } from "react"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useConnection } from "../../react/core"
import { SwitchRow } from "../../settings/kit"
import { showToast } from "../../shell/notifications/toast"

export function BuffTrustPolicyRow(props: { server: Server }) {
  const t = useI18n().buff.t
  const connected = useConnection(props.server).status === "connected"
  const rpc = props.server.api().rpc(BuffTrust.Rpc)
  const [askFirst, setAskFirst] = useState(true)
  useEffect(() => {
    if (!connected) return
    const stop = new AbortController()
    void rpc.get().then(
      (state) => setAskFirst(state.askFirst),
      () => undefined,
    )
    void (async () => {
      for await (const event of rpc.events.subscribe("changed", { signal: stop.signal }))
        setAskFirst(event.data.askFirst)
    })().catch(() => undefined)
    return () => stop.abort()
  }, [connected, props.server])
  const change = (value: boolean) => {
    setAskFirst(value)
    void rpc.set({ askFirst: value }).catch((error: unknown) => {
      setAskFirst(!value)
      showToast({
        title: t(BuffFirstRun.ASK_FIRST.title),
        description: formatServerError(error, undefined, t("Failed.")),
      })
    })
  }
  return (
    <SwitchRow
      action="buff-trust-ask-first"
      title={t(BuffFirstRun.ASK_FIRST.title)}
      description={t(BuffFirstRun.ASK_FIRST.note)}
      checked={askFirst}
      onChange={change}
    />
  )
}
