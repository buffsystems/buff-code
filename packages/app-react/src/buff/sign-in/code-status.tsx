// Waiting for the sign-in to Buff to be confirmed (#457), ported from the Solid window's
// sign-in-code.tsx: how long the code still lasts, «Open cabinet», «Cancel» and, once the code
// expired, «Get a new code»; and under the connector address, where to get it.

import { Button, Spinner } from "@buff/ui/react"
import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import { BuffLinks } from "@opencode/schema/buff-links"
import { useEffect, useState } from "react"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"

export function BuffSignInCodeStatus(props: {
  url: string
  expires: number
  onCancel: () => void
  onRenew: () => void
}) {
  const platform = usePlatform()
  const t = useI18n().buff.t
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const left = BuffFirstRun.codeLeft(props.expires, now)
  return (
    <div className="flex flex-col gap-4" data-component="buff-sign-in-code">
      {left ? (
        <div className="flex items-center gap-2 text-sm">
          <Spinner />
          <span>
            {t("Waiting for confirmation in the cabinet · the code is valid for")} <b data-slot="left">{left}</b>
          </span>
        </div>
      ) : (
        <div className="ui-error" data-slot="expired">
          {t(BuffFirstRun.CODE_EXPIRED)}
        </div>
      )}
      <div className="flex gap-2">
        {left ? (
          <Button variant="primary" data-action="buff-sign-in-cabinet" onClick={() => platform.openExternal(props.url)}>
            {t("Open cabinet")}
          </Button>
        ) : (
          <Button variant="primary" data-action="buff-sign-in-renew" onClick={props.onRenew}>
            {t("Get a new code")}
          </Button>
        )}
        <Button variant="ghost" data-action="buff-sign-in-cancel" onClick={props.onCancel}>
          {t("Cancel")}
        </Button>
      </div>
    </div>
  )
}

export function BuffConnectorHint() {
  const platform = usePlatform()
  const { t, locale } = useI18n().buff
  return (
    <div className="ui-hint" data-component="buff-connector-hint">
      {t(BuffFirstRun.CONNECTOR_HINT)}{" "}
      <button type="button" className="ui-link" onClick={() => platform.openExternal(BuffLinks.localized(BuffLinks.signIn, locale))}>
        {t("Where to get the connector address")}
      </button>
    </div>
  )
}
