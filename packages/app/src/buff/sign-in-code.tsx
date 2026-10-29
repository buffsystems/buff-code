import { createSignal, onCleanup, Show } from "solid-js"
import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import { BuffLinks } from "@opencode/schema/buff-links"
import { Button } from "@opencode/ui/button"
import { Spinner } from "@opencode/ui/spinner"
import { usePlatform } from "@/runtime/platform/platform"
import { useBuffText } from "./i18n"
import "./sign-in.css"

/**
 * Ожидание подтверждения входа в Buff (#457): сколько ещё действует код, «Открыть кабинет»,
 * «Отмена» и, когда код истёк, «Получить новый код» — вместо одной строки «Ждём…».
 */
export function BuffSignInCodeStatus(props: {
  url: string
  expires: number
  onCancel: () => void
  onRenew: () => void
}) {
  const platform = usePlatform()
  const { t } = useBuffText()
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(timer))
  const left = () => BuffFirstRun.codeLeft(props.expires, now())
  return (
    <div class="buff-sign-in-code" data-component="buff-sign-in-code">
      <Show
        when={left()}
        fallback={
          <div class="buff-sign-in-expired" data-slot="expired">
            {t(BuffFirstRun.CODE_EXPIRED)}
          </div>
        }
      >
        {(value) => (
          <div class="buff-sign-in-wait">
            <Spinner />
            <span>
              {t("Waiting for confirmation in the cabinet · the code is valid for")} <b data-slot="left">{value()}</b>
            </span>
          </div>
        )}
      </Show>
      <div class="buff-sign-in-actions">
        <Show
          when={left()}
          fallback={
            <Button size="large" variant="contrast" data-action="buff-sign-in-renew" onClick={() => props.onRenew()}>
              {t("Get a new code")}
            </Button>
          }
        >
          <Button
            size="large"
            variant="contrast"
            data-action="buff-sign-in-cabinet"
            onClick={() => platform.openExternal(props.url)}
          >
            {t("Open cabinet")}
          </Button>
        </Show>
        <Button size="large" variant="ghost" data-action="buff-sign-in-cancel" onClick={() => props.onCancel()}>
          {t("Cancel")}
        </Button>
      </div>
    </div>
  )
}

/** Под полем адреса: где его взять — и страница документации о входе. */
export function BuffConnectorHint() {
  const platform = usePlatform()
  const { t, locale } = useBuffText()
  return (
    <div class="buff-sign-in-hint" data-component="buff-connector-hint">
      {t(BuffFirstRun.CONNECTOR_HINT)}{" "}
      <button type="button" class="buff-sign-in-link" onClick={() => platform.openExternal(BuffLinks.localized(BuffLinks.signIn, locale()))}>
        {t("Where to get the connector address")}
      </button>
    </div>
  )
}
