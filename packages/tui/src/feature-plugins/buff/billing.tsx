import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffBilling } from "@opencode/schema/buff-billing"
import { BuffContext } from "@opencode/schema/buff-context"
import { failureMessage } from "@opencode/schema/buff-failure"
import open from "open"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { followDirectory } from "./follow"
import { n, t } from "./locale"

/**
 * Остаток и расход в консоли (#455): остаток организации виден в строке состояния, о том, что
 * средств мало или нет, говорит предупреждение, а /balance показывает запас, цены тарифа, оценку
 * этой сессии и свой расход по дням. Слова — общие с окном (`BuffBilling`), читает ядро.
 */

const BUFF = "buff"
const RECHECK_MS = 5 * 60_000
const AFTER_TURN_MS = 5_000

// Одно состояние на консоль: строка состояния, /balance и стоимость сессии читают одно и то же.
const [known, setKnown] = createSignal<BuffBilling.Info | undefined>()

/** Оценка стоимости сессии по ценам тарифа; у сессий не на моделях Buff её нет. */
export function buffSessionCost(context: Context, sessionID: string | undefined): string | undefined {
  const session = sessionID ? context.data.session.get(sessionID) : undefined
  if (!session || session.model?.providerID !== BUFF) return undefined
  return BuffBilling.sessionCost(session.tokens, known())
}

export function BalanceLabel(props: { context: Context; info: BuffBilling.Info | undefined }) {
  const text = () => props.context.theme.text
  const color = (info: BuffBilling.Info) =>
    info.exhausted ? text().feedback.error.base : info.low ? text().feedback.warning.base : text().muted
  // Строка состояния узкая: при нуле — сумма красным, словами говорит предупреждение.
  const label = (info: BuffBilling.Info) =>
    info.exhausted ? BuffBilling.rub(info.balanceRub) : BuffBilling.balanceLabel(info, t)
  return <Show when={props.info}>{(info) => <text fg={color(info())}>{label(info())}</text>}</Show>
}

/** Остаток под полем ввода сессии — только когда средств мало или нет: там уже видна стоимость
 *  сессии, и строка не вмещает всё сразу. На домашнем экране остаток виден всегда. */
export function sessionBalance(info: BuffBilling.Info | undefined): BuffBilling.Info | undefined {
  return info && (info.low || info.exhausted) ? info : undefined
}

export interface Row {
  readonly title: string
  readonly description: string
  readonly value: "cabinet" | "row"
}

/** Что показывает /balance: строка за строкой, дни — от сегодняшнего назад. */
export function balanceRows(info: BuffBilling.Info, today: string, sessionCost: string | undefined): Row[] {
  const row = (title: string, description: string): Row => ({ title, description, value: "row" })
  const prices =
    info.priceInputRubPerM === null || info.priceOutputRubPerM === null
      ? t("no price set")
      : t("input {input} · output {output}", {
          input: BuffBilling.rub(info.priceInputRubPerM),
          output: BuffBilling.rub(info.priceOutputRubPerM),
        })
  return [
    row(
      t("Balance of {org}", { org: info.org }),
      info.exhausted
        ? `${BuffBilling.rub(info.balanceRub)} · ${BuffBilling.runwayShort(info, t)}`
        : BuffBilling.rub(info.balanceRub),
    ),
    ...(info.exhausted ? [] : [row(t("Will last at the current spending"), BuffBilling.runwayShort(info, t))]),
    row(t("Tariff"), info.tariff ?? t("not assigned")),
    row(t("Price per 1M tokens"), prices),
    ...(sessionCost ? [row(t("This session (estimate)"), sessionCost)] : []),
    row(
      t("My spending over {window}", { window: n(info.mine.windowDays, "{n} day|{n} days") }),
      BuffBilling.rub(info.mine.totalRub),
    ),
    ...BuffBilling.spendDays(info.mine, today)
      .toReversed()
      .map((day) => row(`  ${BuffBilling.dayLabel(day.day)}`, BuffBilling.rub(day.rub))),
    ...(info.cabinetUrl ? [{ title: t("Open cabinet"), description: info.cabinetUrl, value: "cabinet" as const }] : []),
  ]
}

function Commands(props: { context: Context; refresh: (quiet: boolean) => Promise<BuffBilling.Info | undefined> }) {
  const { context } = props
  const sessionID = () => {
    const route = context.ui.router.current()
    return route.type === "session" ? route.sessionID : undefined
  }
  const show = async () => {
    const info = await props.refresh(false)
    if (!info) return
    const picked = await context.ui.dialog.select({
      title: t("Balance and spending"),
      options: balanceRows(info, new Date().toISOString().slice(0, 10), buffSessionCost(context, sessionID())),
    })
    context.ui.dialog.clear()
    if (picked !== "cabinet") return
    await open(info.cabinetUrl).catch(() =>
      context.ui.toast.show({ message: t("Buff cabinet: {url}", { url: info.cabinetUrl }), variant: "info" }),
    )
  }
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.billing.show",
        title: t("Buff: balance and spending"),
        group: "Buff",
        palette: true as const,
        slash: { name: "balance" },
        run: () => void show(),
      },
    ],
  }))
  // Свежесть: при появлении каталога, при смене контекста и раз в несколько минут.
  onMount(() => {
    const stop = new AbortController()
    const timer = setInterval(() => void props.refresh(true), RECHECK_MS)
    onCleanup(() => {
      stop.abort()
      clearInterval(timer)
    })
    void (async () => {
      for await (const event of context.client.rpc(BuffContext.Rpc).events.subscribe("changed", {
        signal: stop.signal,
      })) {
        if (event.location?.directory === context.location?.directory) void props.refresh(true)
      }
    })().catch(() => undefined)
  })
  // Ход закончился — токены сессии выросли: перечитать остаток чуть погодя.
  let seen = 0
  let later: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const id = sessionID()
    const tokens = id ? context.data.session.get(id)?.tokens : undefined
    const now = tokens ? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write : 0
    if (now === seen) return
    seen = now
    clearTimeout(later)
    later = setTimeout(() => void props.refresh(true), AFTER_TURN_MS)
  })
  onCleanup(() => clearTimeout(later))
  followDirectory(
    () => context.location?.directory,
    () => void props.refresh(true),
  )
  return null
}

export default Plugin.define({
  id: "buff.billing",
  setup(context) {
    const rpc = context.client.rpc(BuffBilling.Rpc)
    // О том же состоянии предупреждаем один раз, а не при каждой проверке.
    let warned = ""
    const refresh = async (quiet: boolean) => {
      try {
        const info = await rpc.get(undefined, { location: context.location })
        setKnown(info)
        const warning = BuffBilling.warning(info, t)
        const state = warning ? `${info.org}:${info.exhausted}` : ""
        if (warning && state !== warned)
          context.ui.toast.show({
            message: t("{warning} /balance — details.", { warning }),
            variant: "warning",
            // О деньгах — дольше обычного: уведомление приходит, пока человек ещё не смотрит.
            duration: 15_000,
          })
        warned = state
        return info
      } catch (error) {
        const type = typeof error === "object" && error !== null && "type" in error ? String(error.type) : ""
        if (type === "signed_out" || type === "no_context") setKnown(undefined)
        if (!quiet)
          context.ui.toast.show({ message: failureMessage(error, t("Could not get the balance.")), variant: "error" })
        return undefined
      }
    }
    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => (
        <Show when={input.sessionID}>
          <BalanceLabel context={context} info={sessionBalance(known())} />
        </Show>
      ),
    })
    context.ui.slot({
      append: "home.footer.status",
      render: () => <BalanceLabel context={context} info={known()} />,
    })
    context.ui.slot({ append: "app", render: () => <Commands context={context} refresh={refresh} /> })
  },
})
