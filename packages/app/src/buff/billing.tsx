import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { useParams } from "@solidjs/router"
import { BuffBilling } from "@opencode/schema/buff-billing"
import { BuffContext } from "@opencode/schema/buff-context"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { usePlatform } from "@/runtime/platform/platform"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useBuffText } from "./i18n"
import "./billing.css"

/**
 * Остаток и расход в окне (#455): остаток организации рядом с выбором модели, полоса над полем
 * ввода, когда средств мало или нет, и окно «Баланс и расход» — на сколько хватит, цены тарифа,
 * оценка этой сессии и свой расход по дням. Пополняется баланс в кабинете, отсюда — ссылка.
 * Что и какими словами показать, решает `@opencode/schema/buff-billing`, как и в консоли.
 */

const BUFF = "buff"
const RECHECK_MS = 5 * 60_000
const AFTER_TURN_MS = 5_000

type Known = { readonly info?: BuffBilling.Info; readonly problem?: string }
// Одно состояние на каталог: чип, полоса и стоимость сессии читают одно и то же.
const [known, setKnown] = createSignal<ReadonlyMap<string, Known>>(new Map())
const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set())

const today = () => new Date().toISOString().slice(0, 10)

/** Сведения для каталога и способ их перечитать. */
export function createBuffBilling(directory: Accessor<string | undefined>) {
  const sdk = useServerSDK()
  const rpc = sdk.api.rpc(BuffBilling.Rpc)
  const refresh = async () => {
    const dir = directory()
    if (!dir || sdk.connection.status() !== "connected") return
    const put = (value: Known) => setKnown((map) => new Map(map).set(dir, value))
    await rpc.get(undefined, { location: { directory: dir } }).then(
      (info) => put({ info }),
      (error: unknown) => {
        const type = typeof error === "object" && error !== null && "type" in error ? String(error.type) : ""
        // Без входа и без контекста показывать нечего; при сбое связи прежние цифры остаются.
        if (type === "signed_out" || type === "no_context") return put({})
        put({
          info: known().get(dir)?.info,
          // Причина — английской строкой (сервера или наша); переводит экран (#472).
          problem: formatServerError(error, undefined, "Could not get the balance."),
        })
      },
    )
  }
  const state = () => {
    const dir = directory()
    return dir ? known().get(dir) : undefined
  }
  return { info: () => state()?.info, problem: () => state()?.problem, refresh, rpc }
}

export type Billing = ReturnType<typeof createBuffBilling>

export function useBuffBilling(): Billing {
  const location = useWorkspaceLocation()
  return createBuffBilling(() => location().directory)
}

/**
 * Оценка стоимости сессии по ценам тарифа. undefined — сессия не на моделях Buff (у неё своя
 * стоимость); `text` пуст, когда оценивать нечего: цен нет или токенов ещё не было.
 */
export function useBuffSessionCost(
  sessionID: Accessor<string | undefined>,
): Accessor<{ readonly text?: string } | undefined> {
  const data = useData()
  const billing = useBuffBilling()
  return createMemo(() => {
    const id = sessionID()
    const session = id ? data.session.get(id) : undefined
    if (!session || session.model?.providerID !== BUFF) return undefined
    return { text: BuffBilling.sessionCost(session.tokens, billing.info()) }
  })
}

function openCabinet(platform: ReturnType<typeof usePlatform>, info: BuffBilling.Info | undefined) {
  if (info?.cabinetUrl) platform.openExternal(info.cabinetUrl)
}

function Summary(props: { info: BuffBilling.Info }) {
  const { t, n } = useBuffText()
  return (
    <div class="buff-billing-summary" data-state={props.info.exhausted ? "exhausted" : props.info.low ? "low" : "ok"}>
      <span class="buff-billing-label">{t("Balance of organization {org}", { org: props.info.org })}</span>
      <span class="buff-billing-balance" data-slot="balance">
        {BuffBilling.rub(props.info.balanceRub)}
      </span>
      <span class="buff-billing-note" data-slot="runway">
        {BuffBilling.runway(props.info, t, n)}
      </span>
    </div>
  )
}

function Spend(props: { mine: BuffBilling.Info["mine"] }) {
  const days = createMemo(() => BuffBilling.spendDays(props.mine, today()))
  const spent = createMemo(() => days().filter((day) => day.rub > 0))
  const { t, n } = useBuffText()
  return (
    <div class="buff-billing-block" data-component="buff-billing-spend">
      <div class="buff-billing-row">
        <span class="buff-billing-label">
          {t("My spending over {window}", { window: n(props.mine.windowDays, "{n} day|{n} days") })}
        </span>
        <span class="buff-billing-value" data-slot="total">
          {BuffBilling.rub(props.mine.totalRub)}
        </span>
      </div>
      <div class="buff-billing-chart" role="img" aria-label={t("Spending by day")}>
        <For each={days()}>
          {(day) => (
            <span
              class="buff-billing-bar"
              title={`${BuffBilling.dayLabel(day.day)} — ${BuffBilling.rub(day.rub)}`}
              style={{ height: `${Math.max(day.share * 100, day.rub > 0 ? 6 : 2)}%` }}
              data-empty={day.rub > 0 ? undefined : "true"}
            />
          )}
        </For>
      </div>
      <div class="buff-billing-axis">
        <span>{BuffBilling.dayLabel(days()[0]?.day ?? today())}</span>
        <span>{BuffBilling.dayLabel(today())}</span>
      </div>
      <Show when={spent().length} fallback={<span class="buff-billing-note">{t("No spending over this period.")}</span>}>
        <div class="buff-billing-days">
          <For each={spent().toReversed()}>
            {(day) => (
              <div class="buff-billing-row" data-slot="day">
                <span>{BuffBilling.dayLabel(day.day)}</span>
                <span>{BuffBilling.rub(day.rub)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function BillingDialog(props: { billing: Billing; sessionCost: Accessor<{ readonly text?: string } | undefined> }) {
  const platform = usePlatform()
  const { t } = useBuffText()
  const info = props.billing.info
  const prices = () => {
    const i = info()
    if (!i || i.priceInputRubPerM === null || i.priceOutputRubPerM === null) return undefined
    return t("input {input}, output {output} per 1M tokens", {
      input: BuffBilling.rub(i.priceInputRubPerM),
      output: BuffBilling.rub(i.priceOutputRubPerM),
    })
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{t("Balance and spending")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-billing" data-component="buff-billing-dialog">
          <Show when={props.billing.problem()}>
            {(problem) => (
              <div class="buff-billing-problem" data-slot="problem">
                {t(problem())}
              </div>
            )}
          </Show>
          <Show when={info()} fallback={<span class="buff-billing-note">{t("No balance information yet.")}</span>}>
            {(i) => (
              <>
                <Summary info={i()} />
                <div class="buff-billing-block">
                  <div class="buff-billing-row" data-slot="tariff">
                    <span class="buff-billing-label">{t("Tariff")}</span>
                    <span class="buff-billing-value">{i().tariff ?? t("not assigned")}</span>
                  </div>
                  <Show when={prices()}>
                    <span class="buff-billing-note" data-slot="prices">
                      {prices()}
                    </span>
                  </Show>
                  <Show when={props.sessionCost()?.text}>
                    {(cost) => (
                      <>
                        <div class="buff-billing-row" data-slot="session">
                          <span class="buff-billing-label">{t("This session")}</span>
                          <span class="buff-billing-value">{cost()}</span>
                        </div>
                        <span class="buff-billing-note">
                          {t("An estimate at tariff prices: cached input is counted as regular; Buff calculates the exact charge.")}
                        </span>
                      </>
                    )}
                  </Show>
                </div>
                <Spend mine={i().mine} />
                <span class="buff-billing-note">
                  {t("The organization administrator tops up the balance in the Buff cabinet: «Settings» → organization → «Balance».")}
                </span>
              </>
            )}
          </Show>
          <div class="buff-billing-actions">
            <Show when={info()?.cabinetUrl}>
              <Button
                size="normal"
                variant="contrast"
                data-action="buff-billing-cabinet"
                onClick={() => openCabinet(platform, info())}
              >
                {t("Open cabinet")}
              </Button>
            </Show>
            <Button
              size="normal"
              variant="neutral"
              data-action="buff-billing-refresh"
              onClick={() => void props.billing.refresh()}
            >
              {t("Refresh")}
            </Button>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}

/** Открывает окно «Баланс и расход» — для чипа, полосы и карточки отказа хода. */
export function useBuffBillingDialog() {
  const dialog = useDialog()
  const params = useParams<{ id?: string }>()
  const billing = useBuffBilling()
  const sessionCost = useBuffSessionCost(() => params.id)
  const open = () => {
    void billing.refresh()
    void dialog.show(() => <BillingDialog billing={billing} sessionCost={sessionCost} />)
  }
  return { billing, sessionCost, open }
}

/**
 * Остаток рядом с выбором модели. Он же следит за свежестью: при появлении, при смене
 * контекста, после каждого хода (расход сессии вырос) и раз в несколько минут.
 */
export function BuffBalanceChip() {
  const sdk = useServerSDK()
  const data = useData()
  const location = useWorkspaceLocation()
  const params = useParams<{ id?: string }>()
  const { billing, open } = useBuffBillingDialog()
  const { t, n } = useBuffText()

  onMount(() => {
    const stop = new AbortController()
    const timer = setInterval(() => void billing.refresh(), RECHECK_MS)
    onCleanup(() => {
      stop.abort()
      clearInterval(timer)
    })
    void billing.refresh()
    void (async () => {
      for await (const event of sdk.api.rpc(BuffContext.Rpc).events.subscribe("changed", { signal: stop.signal })) {
        if (event.location?.directory === location().directory) void billing.refresh()
      }
    })().catch(() => undefined)
  })

  // Ход закончился — токены сессии выросли: перечитать остаток чуть погодя.
  const spent = createMemo(() => {
    const tokens = params.id ? data.session.get(params.id)?.tokens : undefined
    return tokens ? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write : 0
  })
  let seen = spent()
  let later: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const now = spent()
    if (now === seen) return
    seen = now
    clearTimeout(later)
    later = setTimeout(() => void billing.refresh(), AFTER_TURN_MS)
  })
  onCleanup(() => clearTimeout(later))

  return (
    <Show when={billing.info()}>
      {(info) => (
        <button
          type="button"
          class="buff-balance-chip"
          data-component="buff-balance-chip"
          data-state={info().exhausted ? "exhausted" : info().low ? "low" : "ok"}
          title={t("Balance of organization {org}: {runway}", { org: info().org, runway: BuffBilling.runway(info(), t, n) })}
          onClick={open}
        >
          {BuffBilling.balanceLabel(info(), t)}
        </button>
      )}
    </Show>
  )
}

/** Полоса над полем ввода: средств мало или нет. «Скрыть» — до перезапуска, пока состояние то же. */
export function BuffFundsStrip() {
  const platform = usePlatform()
  const { t } = useBuffText()
  const { billing, open } = useBuffBillingDialog()
  const key = () => {
    const info = billing.info()
    return info ? `${info.org}:${info.exhausted ? "exhausted" : "low"}` : ""
  }
  const text = () => {
    const info = billing.info()
    return info && !hidden().has(key()) ? BuffBilling.warning(info, t) : undefined
  }
  return (
    <Show when={text()}>
      {(warning) => (
        <div
          class="buff-funds-strip"
          data-component="buff-funds-strip"
          data-state={billing.info()?.exhausted ? "exhausted" : "low"}
        >
          <Icon name="outline-hexagonal-warning" class="shrink-0" />
          <span class="min-w-0 flex-1">{warning()}</span>
          <Button
            size="small"
            variant="neutral"
            data-action="buff-funds-cabinet"
            onClick={() => openCabinet(platform, billing.info())}
          >
            {t("Open cabinet")}
          </Button>
          <Button size="small" variant="ghost" data-action="buff-funds-details" onClick={open}>
            {t("More details")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            data-action="buff-funds-hide"
            onClick={() => setHidden((set) => new Set(set).add(key()))}
          >
            {t("Hide")}
          </Button>
        </div>
      )}
    </Show>
  )
}

/** Раздел «Баланс» в настройках провайдера Buff: остаток, запас и ссылка в кабинет. */
export function BuffBillingSection(props: { directory: string | undefined }) {
  const platform = usePlatform()
  const { t, n } = useBuffText()
  const billing = createBuffBilling(() => props.directory)
  onMount(() => void billing.refresh())
  return (
    <Show when={billing.info()}>
      {(info) => (
        <div class="settings-section" data-component="buff-billing-section">
          <h3 class="settings-section-title">{t("Buff balance")}</h3>
          <div class="buff-billing">
            <Summary info={info()} />
            <span class="buff-billing-note">
              {t("My spending over {window}: {sum}. The organization administrator tops up the balance in the Buff cabinet.", {
                window: n(info().mine.windowDays, "{n} day|{n} days"),
                sum: BuffBilling.rub(info().mine.totalRub),
              })}
            </span>
            <div class="buff-billing-actions">
              <Button
                size="normal"
                variant="neutral"
                data-action="buff-billing-cabinet"
                onClick={() => openCabinet(platform, info())}
              >
                {t("Open cabinet")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
