import { createSignal, onCleanup, onMount } from "solid-js"
import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import { BuffTrust } from "@opencode/schema/buff-trust"
import { Switch } from "@opencode/ui/switch"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { SettingsRow } from "@/settings/row"
import { showToast } from "@/shell/notifications/toast"
import { useBuffText } from "./i18n"

/** «Проверять хуки и команды проекта» (#457) — тот же переключатель, что в знакомстве. */
export function BuffTrustPolicyRow() {
  const sdk = useServerSDK()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffTrust.Rpc)
  const [askFirst, setAskFirst] = createSignal(true)
  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => stop.abort())
    void rpc.get().then(
      (state) => setAskFirst(state.askFirst),
      () => undefined,
    )
    void (async () => {
      for await (const event of rpc.events.subscribe("changed", { signal: stop.signal }))
        setAskFirst((event.data as { askFirst: boolean }).askFirst)
    })().catch(() => undefined)
  })
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
    <SettingsRow title={t(BuffFirstRun.ASK_FIRST.title)} description={t(BuffFirstRun.ASK_FIRST.note)}>
      <div data-action="buff-trust-ask-first">
        <Switch checked={askFirst()} onChange={change} />
      </div>
    </SettingsRow>
  )
}
