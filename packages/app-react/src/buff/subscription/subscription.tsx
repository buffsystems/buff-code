// The Buff account's subscription in the window (#966): the busiest window beside the model
// picker, the «Subscription usage» dialog — the plan and each window with how much is used and
// when it resets — and the same in the providers settings. The organization's balance (the
// company sign-in) lives beside it, in ../billing.

import { Button, Dialog, DialogBody, DialogFooter } from "@buff/ui/react"
import { accountSignedIn } from "@opencode/app/react-reuse/buff-providers"
import { BuffSubscription } from "@opencode/schema/buff-subscription"
import { useEffect, useRef } from "react"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useProviderCatalog } from "../../providers/catalog/use-catalog"
import { useConnection, useServerData } from "../../react/core"
import { useStore } from "../../react/use-store"
import { SettingsSection } from "../../settings/kit"
import { dayLabel, refreshSubscription, serverSubscription, subscription, usageState, type Known } from "./store"
import "../bar.css"
import "./subscription.css"

const ACCOUNT = "buff-account"
const RECHECK_MS = 5 * 60_000
const AFTER_TURN_MS = 5_000

/** The usage known for a server and a way to read it again. */
export function useBuffSubscription(server: Server, directory: string) {
  const known: Known | undefined = useStore(subscription, (map) => map.get(server.key))
  const connected = useConnection(server).status === "connected"
  const refresh = () =>
    connected ? refreshSubscription(server.key, serverSubscription(server, directory || undefined)) : Promise.resolve()
  // Whose account is signed in: a sign-in or a sign-out is a reason to read the usage again.
  const account = accountSignedIn(useProviderCatalog(server, directory || undefined).integrations)
  return { usage: known?.usage, problem: known?.problem, refresh, account }
}

/** The plan by its name, its state and each window: how much is used and when it resets. */
export function SubscriptionSummary(props: { usage: BuffSubscription.Usage }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const plan = props.usage.plan
  const until = plan.activeUntil ? dayLabel(plan.activeUntil, i18n.intl) : undefined
  const state =
    plan.status === "active" && until
      ? t("active until {date}", { date: until })
      : BuffSubscription.statusLabel(plan, t)
  const now = Date.now()
  return (
    <div className="flex flex-col gap-3" data-component="buff-subscription-summary" data-status={plan.status}>
      <div className="flex flex-col gap-1">
        {props.usage.login && (
          <span className="ui-note">{t("Buff account {login}", { login: props.usage.login })}</span>
        )}
        <span className="ui-title" data-slot="plan">
          {BuffSubscription.planName(plan, i18n.buff.locale) ?? t("Subscription")}
        </span>
        <span className={plan.status === "active" ? "ui-hint" : "ui-error"} data-slot="status">
          {state}
        </span>
      </div>
      {props.usage.windows.map((window) => {
        const tone = window.usedPct >= 100 ? "exhausted" : window.usedPct >= BuffSubscription.LOW_PCT ? "low" : "ok"
        return (
          <div key={window.id} className="flex flex-col gap-1" data-slot="window" data-window={window.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="ui-note">{BuffSubscription.windowLabel(window.id, t)}</span>
              <span className="ui-num font-medium">{BuffSubscription.usedLabel(window, t)}</span>
            </div>
            <div
              className="buff-usage-meter"
              role="progressbar"
              aria-label={BuffSubscription.windowLabel(window.id, t)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(window.usedPct, 100)}
              data-state={tone}
            >
              <span style={{ width: `${Math.min(window.usedPct, 100)}%` }} />
            </div>
            <span className="ui-hint" data-slot="reset">
              {BuffSubscription.resetLabel(window, now, t) ?? t("not started yet")}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function SubscriptionDialog(props: { server: Server; directory: string; onClose: () => void }) {
  const t = useI18n().buff.t
  const state = useBuffSubscription(props.server, props.directory)
  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => !open && props.onClose()}
      title={t("Subscription usage")}
      closeLabel={t("Close")}
    >
      <DialogBody>
        <div className="flex flex-col gap-4" data-component="buff-subscription-dialog">
          {state.problem && (
            <p className="ui-error" role="alert" data-slot="problem">
              {t(state.problem)}
            </p>
          )}
          {!state.usage && <span className="ui-note">{t("No subscription information yet.")}</span>}
          {state.usage && <SubscriptionSummary usage={state.usage} />}
          <span className="ui-hint">
            {t(
              "The limits are shared by the site, the phone and this computer. The subscription is managed on the Buff site.",
            )}
          </span>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button data-action="buff-subscription-refresh" onClick={() => void state.refresh()}>
          {t("Refresh")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Open «Subscription usage» — for the chip and for a refused turn. */
export function useBuffSubscriptionDialog(server: Server, directory: string) {
  const dialog = useDialog()
  const state = useBuffSubscription(server, directory)
  return () => {
    void state.refresh()
    dialog.show((close) => <SubscriptionDialog server={server} directory={directory} onClose={close} />)
  }
}

/**
 * The subscription's busiest window beside the model picker. It also keeps the usage fresh: on
 * appearing, after every turn on a subscription tier and every few minutes.
 */
export function BuffUsageChip(props: { server: Server; directory: string; sessionID?: string }) {
  const t = useI18n().buff.t
  const state = useBuffSubscription(props.server, props.directory)
  const open = useBuffSubscriptionDialog(props.server, props.directory)
  const connected = useConnection(props.server).status === "connected"
  const refresh = useRef(state.refresh)
  refresh.current = state.refresh
  useEffect(() => {
    if (!connected) return
    const timer = setInterval(() => void refresh.current(), RECHECK_MS)
    void refresh.current()
    return () => clearInterval(timer)
  }, [connected, props.server, props.directory, state.account])
  // A turn on a subscription tier ended — the usage grew: read it again a moment later.
  const spent = useServerData(props.server, (data) => {
    const session = props.sessionID ? data.session.info[props.sessionID] : undefined
    const tokens = session?.model?.providerID === ACCOUNT ? session.tokens : undefined
    return tokens ? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write : 0
  })
  const seen = useRef(spent)
  useEffect(() => {
    if (spent === seen.current) return
    seen.current = spent
    const later = setTimeout(() => void refresh.current(), AFTER_TURN_MS)
    return () => clearTimeout(later)
  }, [spent])
  const usage = state.usage
  const label = usage ? BuffSubscription.shortLabel(usage, t) : undefined
  if (!usage || !label) return null
  return (
    <button
      type="button"
      className="composer-chip buff-balance"
      data-component="buff-usage-chip"
      data-state={usageState(usage)}
      title={BuffSubscription.warning(usage, Date.now(), t) ?? t("Subscription usage")}
      onClick={open}
    >
      {label}
    </button>
  )
}

/** «Buff subscription» in the providers settings: the plan and the windows. */
export function BuffSubscriptionSection(props: { server: Server; directory: string | undefined }) {
  const t = useI18n().buff.t
  const state = useBuffSubscription(props.server, props.directory ?? "")
  useEffect(() => void state.refresh(), [props.server, props.directory, state.account])
  if (!state.usage) return null
  return (
    <div data-component="buff-subscription-section">
      <SettingsSection title={t("Buff subscription")}>
        <div className="flex flex-col gap-3">
          <SubscriptionSummary usage={state.usage} />
          <span className="ui-hint">
            {t(
              "The limits are shared by the site, the phone and this computer. The subscription is managed on the Buff site.",
            )}
          </span>
          <div className="flex gap-2">
            <Button data-action="buff-subscription-refresh" onClick={() => void state.refresh()}>
              {t("Refresh")}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}
