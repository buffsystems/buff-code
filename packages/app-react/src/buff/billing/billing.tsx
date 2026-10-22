// Balance and spending in the window (#455), ported from the Solid window's buff/billing.tsx: the
// organization's balance beside the model picker, a strip above the prompt when funds run low or
// out, and the «Balance and spending» dialog — how long it lasts, the tariff's prices, this
// session's estimate and one's own spending by day. The balance is topped up in the cabinet. The
// session composer and the draft mount the chip and the strip; the providers settings the section.

import { Button, Dialog, DialogBody, DialogFooter } from "@buff/ui/react"
import { BuffBilling } from "@opencode/schema/buff-billing"
import { BuffContext } from "@opencode/schema/buff-context"
import { TriangleAlert } from "lucide-react"
import { useEffect, useRef } from "react"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useConnection, useServerData } from "../../react/core"
import { useStore } from "../../react/use-store"
import { SettingsSection } from "../../settings/kit"
import { billing, billingKey, billingState, hiddenFunds, refreshBilling, serverBilling, type Known } from "./store"
import "../bar.css"
import "./billing.css"

const BUFF = "buff"
const RECHECK_MS = 5 * 60_000
const AFTER_TURN_MS = 5_000
const today = () => new Date().toISOString().slice(0, 10)

/** The balance known for a server's directory and a way to read it again. */
export function useBuffBilling(server: Server, directory: string) {
  const key = billingKey(server, directory)
  const known: Known | undefined = useStore(billing, (map) => map.get(key))
  const connected = useConnection(server).status === "connected"
  const refresh = () =>
    connected && directory ? refreshBilling(key, directory, serverBilling(server)) : Promise.resolve()
  return { info: known?.info, problem: known?.problem, refresh }
}

/**
 * The session's cost at the tariff's prices. Undefined: the session is not on Buff's models;
 * `text` is empty when there is nothing to estimate yet.
 */
export function useBuffSessionCost(server: Server, sessionID: string | undefined, directory: string) {
  const session = useServerData(server, (state) => (sessionID ? state.session.info[sessionID] : undefined))
  const state = useBuffBilling(server, directory)
  if (!session || session.model?.providerID !== BUFF) return undefined
  return { text: BuffBilling.sessionCost(session.tokens, state.info) }
}

/** Open «Balance and spending» — for the chip, the strip and a refused turn's card. */
export function useBuffBillingDialog(server: Server, directory: string, sessionID?: string) {
  const dialog = useDialog()
  const state = useBuffBilling(server, directory)
  return () => {
    void state.refresh()
    dialog.show((close) => (
      <BillingDialog server={server} directory={directory} sessionID={sessionID} onClose={close} />
    ))
  }
}

function BillingDialog(props: { server: Server; directory: string; sessionID?: string; onClose: () => void }) {
  const t = useI18n().buff.t
  const platform = usePlatform()
  const state = useBuffBilling(props.server, props.directory)
  const cost = useBuffSessionCost(props.server, props.sessionID, props.directory)
  const info = state.info
  const prices =
    info && info.priceInputRubPerM !== null && info.priceOutputRubPerM !== null
      ? t("input {input}, output {output} per 1M tokens", {
          input: BuffBilling.rub(info.priceInputRubPerM),
          output: BuffBilling.rub(info.priceOutputRubPerM),
        })
      : undefined
  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => !open && props.onClose()}
      title={t("Balance and spending")}
      closeLabel={t("Close")}
    >
      <DialogBody>
        <div className="flex flex-col gap-4" data-component="buff-billing-dialog">
          {state.problem && (
            <p className="ui-error" role="alert" data-slot="problem">
              {t(state.problem)}
            </p>
          )}
          {!info && <span className="ui-note">{t("No balance information yet.")}</span>}
          {info && (
            <>
              <BillingSummary info={info} />
              <div className="flex flex-col gap-1">
                <Row label={t("Tariff")} value={info.tariff ?? t("not assigned")} slot="tariff" />
                {prices && (
                  <span className="ui-hint" data-slot="prices">
                    {prices}
                  </span>
                )}
                {cost?.text && (
                  <>
                    <Row label={t("This session")} value={cost.text} slot="session" />
                    <span className="ui-hint">
                      {t(
                        "An estimate at tariff prices: cached input is counted as regular; Buff calculates the exact charge.",
                      )}
                    </span>
                  </>
                )}
              </div>
              <Spend mine={info.mine} />
              <span className="ui-hint">
                {t(
                  "The organization administrator tops up the balance in the Buff cabinet: «Settings» → organization → «Balance».",
                )}
              </span>
            </>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button data-action="buff-billing-refresh" onClick={() => void state.refresh()}>
          {t("Refresh")}
        </Button>
        {info?.cabinetUrl && (
          <Button
            variant="primary"
            data-action="buff-billing-cabinet"
            onClick={() => info.cabinetUrl && platform.openExternal(info.cabinetUrl)}
          >
            {t("Open cabinet")}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}

function Row(props: { label: string; value: string; slot?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm" data-slot={props.slot}>
      <span className="ui-note">{props.label}</span>
      <span className="ui-num font-medium">{props.value}</span>
    </div>
  )
}

/** The organization's balance and how long it lasts. */
export function BillingSummary(props: { info: BuffBilling.Info }) {
  const { t, n } = useI18n().buff
  const state = billingState(props.info)
  return (
    <div className="flex flex-col gap-1" data-state={state}>
      <span className="ui-note">{t("Balance of organization {org}", { org: props.info.org })}</span>
      <span className="ui-title ui-title--lg ui-num" data-slot="balance">
        {BuffBilling.rub(props.info.balanceRub)}
      </span>
      <span className={state === "exhausted" ? "ui-error" : "ui-hint"} data-slot="runway">
        {BuffBilling.runway(props.info, t, n)}
      </span>
    </div>
  )
}

function Spend(props: { mine: BuffBilling.Info["mine"] }) {
  const { t, n } = useI18n().buff
  const days = BuffBilling.spendDays(props.mine, today())
  const spent = days.filter((day) => day.rub > 0)
  return (
    <div className="flex flex-col gap-1" data-component="buff-billing-spend">
      <Row
        label={t("My spending over {window}", { window: n(props.mine.windowDays, "{n} day|{n} days") })}
        value={BuffBilling.rub(props.mine.totalRub)}
        slot="total"
      />
      <div className="buff-billing-chart" role="img" aria-label={t("Spending by day")}>
        {days.map((day) => (
          <span
            key={day.day}
            className="buff-billing-bar"
            title={`${BuffBilling.dayLabel(day.day)} — ${BuffBilling.rub(day.rub)}`}
            style={{ height: `${Math.max(day.share * 100, day.rub > 0 ? 6 : 2)}%` }}
            data-empty={day.rub > 0 ? undefined : "true"}
          />
        ))}
      </div>
      <div className="ui-hint flex justify-between">
        <span>{BuffBilling.dayLabel(days[0]?.day ?? today())}</span>
        <span>{BuffBilling.dayLabel(today())}</span>
      </div>
      {spent.length ? (
        <div className="flex flex-col gap-0.5">
          {spent.toReversed().map((day) => (
            <Row key={day.day} label={BuffBilling.dayLabel(day.day)} value={BuffBilling.rub(day.rub)} slot="day" />
          ))}
        </div>
      ) : (
        <span className="ui-hint">{t("No spending over this period.")}</span>
      )}
    </div>
  )
}

/**
 * The balance beside the model picker. It also keeps it fresh: on appearing, on a context change,
 * after every turn (the session's spending grew) and every few minutes.
 */
export function BuffBalanceChip(props: { server: Server; directory: string; sessionID?: string }) {
  const { t, n } = useI18n().buff
  const state = useBuffBilling(props.server, props.directory)
  const open = useBuffBillingDialog(props.server, props.directory, props.sessionID)
  const connected = useConnection(props.server).status === "connected"
  const refresh = useRef(state.refresh)
  refresh.current = state.refresh
  useEffect(() => {
    if (!connected) return
    const stop = new AbortController()
    const timer = setInterval(() => void refresh.current(), RECHECK_MS)
    void refresh.current()
    void (async () => {
      for await (const event of props.server
        .api()
        .rpc(BuffContext.Rpc)
        .events.subscribe("changed", { signal: stop.signal }))
        if (event.location?.directory === props.directory) void refresh.current()
    })().catch(() => undefined)
    return () => {
      stop.abort()
      clearInterval(timer)
    }
  }, [connected, props.server, props.directory])
  // A turn ended — the session's tokens grew: read the balance again a moment later.
  const spent = useServerData(props.server, (data) => {
    const tokens = props.sessionID ? data.session.info[props.sessionID]?.tokens : undefined
    return tokens ? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write : 0
  })
  const seen = useRef(spent)
  useEffect(() => {
    if (spent === seen.current) return
    seen.current = spent
    const later = setTimeout(() => void refresh.current(), AFTER_TURN_MS)
    return () => clearTimeout(later)
  }, [spent])
  const info = state.info
  if (!info) return null
  return (
    <button
      type="button"
      className="composer-chip buff-balance"
      data-component="buff-balance-chip"
      data-state={billingState(info)}
      title={t("Balance of organization {org}: {runway}", { org: info.org, runway: BuffBilling.runway(info, t, n) })}
      onClick={open}
    >
      {BuffBilling.balanceLabel(info, t)}
    </button>
  )
}

/** A strip above the prompt: funds are low or out. «Hide» lasts until a restart, while the state stays. */
export function BuffFundsStrip(props: { server: Server; directory: string; sessionID?: string }) {
  const t = useI18n().buff.t
  const platform = usePlatform()
  const state = useBuffBilling(props.server, props.directory)
  const open = useBuffBillingDialog(props.server, props.directory, props.sessionID)
  const hidden = useStore(hiddenFunds, (value) => value)
  const info = state.info
  const key = info ? `${info.org}:${info.exhausted ? "exhausted" : "low"}` : ""
  const warning = info && !hidden.has(key) ? BuffBilling.warning(info, t) : undefined
  if (!info || !warning) return null
  return (
    <div
      className="buff-bar"
      data-component="buff-funds-strip"
      data-state={info.exhausted ? "exhausted" : "low"}
      data-tone={info.exhausted ? "danger" : "warning"}
    >
      <TriangleAlert aria-hidden className="buff-bar__icon" />
      <span className="buff-bar__text">{warning}</span>
      {info.cabinetUrl && (
        <Button
          size="sm"
          variant="outline"
          data-action="buff-funds-cabinet"
          onClick={() => info.cabinetUrl && platform.openExternal(info.cabinetUrl)}
        >
          {t("Open cabinet")}
        </Button>
      )}
      <Button size="sm" variant="ghost" data-action="buff-funds-details" onClick={open}>
        {t("More details")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-action="buff-funds-hide"
        onClick={() => hiddenFunds.set((set) => new Set(set).add(key))}
      >
        {t("Hide")}
      </Button>
    </div>
  )
}

/** «Buff balance» in the providers settings: the balance, how long it lasts and the cabinet. */
export function BuffBillingSection(props: { server: Server; directory: string | undefined }) {
  const { t, n } = useI18n().buff
  const platform = usePlatform()
  const state = useBuffBilling(props.server, props.directory ?? "")
  useEffect(() => void state.refresh(), [props.server, props.directory, state.info === undefined])
  const info = state.info
  if (!info) return null
  return (
    <div data-component="buff-billing-section">
      <SettingsSection title={t("Buff balance")}>
        <div className="flex flex-col gap-3">
          <BillingSummary info={info} />
          <span className="ui-hint">
            {t(
              "My spending over {window}: {sum}. The organization administrator tops up the balance in the Buff cabinet.",
              { window: n(info.mine.windowDays, "{n} day|{n} days"), sum: BuffBilling.rub(info.mine.totalRub) },
            )}
          </span>
          <div className="flex gap-2">
            <Button data-action="buff-billing-cabinet" onClick={() => platform.openExternal(info.cabinetUrl ?? "")}>
              {t("Open cabinet")}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}
