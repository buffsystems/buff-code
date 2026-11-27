import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { failureMessage } from "@opencode/schema/buff-failure"
import { BuffSubscription } from "@opencode/schema/buff-subscription"
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { followDirectory } from "./follow"
import { currentLocale, t } from "./locale-state"

/**
 * Расход подписки аккаунта Buff в консоли (#966): самое занятое окно видно в строке состояния,
 * о почти исчерпанном лимите говорит предупреждение, а /usage показывает тариф и оба окна —
 * сколько израсходовано и когда лимит обновится. Слова — общие с окном (`BuffSubscription`),
 * читает ядро. Остаток организации (вход компании) — рядом, в `billing.tsx`.
 */

const ACCOUNT = "buff-account"
const RECHECK_MS = 5 * 60_000
const AFTER_TURN_MS = 5_000

// Одно состояние на консоль: строка состояния и /usage читают одно и то же.
const [known, setKnown] = createSignal<BuffSubscription.Usage | undefined>()

export function UsageLabel(props: { context: Context; usage: BuffSubscription.Usage | undefined }) {
  const text = () => props.context.theme.text
  const color = (usage: BuffSubscription.Usage) => {
    const used = BuffSubscription.tightest(usage)?.usedPct ?? 0
    if (usage.plan.status !== "active" || used >= 100) return text().feedback.error.base
    return used >= BuffSubscription.LOW_PCT ? text().feedback.warning.base : text().muted
  }
  return (
    <Show when={props.usage}>
      {(usage) => <text fg={color(usage())}>{BuffSubscription.shortLabel(usage(), t) ?? ""}</text>}
    </Show>
  )
}

export interface Row {
  readonly title: string
  readonly description: string
  readonly value: "row"
}

/** День коротко: «24.12.2026». */
const day = (iso: string) => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined
  const two = (value: number) => String(value).padStart(2, "0")
  return `${two(at.getUTCDate())}.${two(at.getUTCMonth() + 1)}.${at.getUTCFullYear()}`
}

/** Что показывает /usage: аккаунт, тариф и окна подписки. */
export function usageRows(usage: BuffSubscription.Usage, now: number): Row[] {
  const row = (title: string, description: string): Row => ({ title, description, value: "row" })
  const until = usage.plan.activeUntil ? day(usage.plan.activeUntil) : undefined
  const state =
    usage.plan.status === "active" && until
      ? t("active until {date}", { date: until })
      : BuffSubscription.statusLabel(usage.plan, t)
  return [
    ...(usage.login ? [row(t("Buff account"), usage.login)] : []),
    row(
      t("Subscription plan"),
      [BuffSubscription.planName(usage.plan, currentLocale()), state].filter(Boolean).join(" · "),
    ),
    ...usage.windows.map((window) =>
      row(
        BuffSubscription.windowLabel(window.id, t),
        // Список консоли узок (около 54 знаков): доля — числом, без слова «израсходовано».
        [t("{pct}%", { pct: window.usedPct }), BuffSubscription.resetLabel(window, now, t)].filter(Boolean).join(" · "),
      ),
    ),
  ]
}

function Commands(props: {
  context: Context
  refresh: (quiet: boolean) => Promise<BuffSubscription.Usage | undefined>
}) {
  const { context } = props
  const sessionID = () => {
    const route = context.ui.router.current()
    return route.type === "session" ? route.sessionID : undefined
  }
  const show = async () => {
    const usage = await props.refresh(false)
    if (!usage) return
    await context.ui.dialog.select({ title: t("Subscription usage"), options: usageRows(usage, Date.now()) })
    context.ui.dialog.clear()
  }
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.subscription.show",
        title: t("Buff: subscription usage"),
        group: "Buff",
        palette: true as const,
        slash: { name: "usage" },
        run: () => void show(),
      },
    ],
  }))
  onMount(() => {
    const timer = setInterval(() => void props.refresh(true), RECHECK_MS)
    onCleanup(() => clearInterval(timer))
    void props.refresh(true)
  })
  // Вход или выход аккаунта — расход появляется или исчезает сразу, а не при следующей проверке.
  const account = () =>
    context.data.location.integration
      .list(context.location)
      ?.find((item) => item.id === ACCOUNT)
      ?.connections.some((item) => item.type === "credential") ?? false
  createEffect(on(account, () => void props.refresh(true), { defer: true }))
  // Ход закончился — расход вырос: перечитать чуть погодя.
  let seen = 0
  let later: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const id = sessionID()
    const session = id ? context.data.session.get(id) : undefined
    const tokens = session?.model?.providerID === ACCOUNT ? session.tokens : undefined
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
  id: "buff.subscription",
  setup(context) {
    const rpc = context.client.rpc(BuffSubscription.Rpc)
    // Об одном и том же состоянии предупреждаем один раз, а не при каждой проверке.
    let warned = ""
    const refresh = async (quiet: boolean) => {
      try {
        const usage = await rpc.get(undefined, { location: context.location })
        setKnown(usage)
        const warning = BuffSubscription.warning(usage, Date.now(), t)
        const window = BuffSubscription.tightest(usage)
        const state = warning && window ? `${window.id}:${window.usedPct >= 100}` : ""
        if (warning && state !== warned)
          context.ui.toast.show({
            message: t("{warning} /usage — details.", { warning }),
            variant: "warning",
            duration: 15_000,
          })
        warned = state
        return usage
      } catch (error) {
        const type = typeof error === "object" && error !== null && "type" in error ? String(error.type) : ""
        if (type === "signed_out") setKnown(undefined)
        if (!quiet)
          context.ui.toast.show({
            message: failureMessage(error, t("Could not get the subscription usage.")),
            variant: type === "signed_out" ? "info" : "error",
          })
        return undefined
      }
    }
    const onAccount = (sessionID: string | undefined) =>
      sessionID !== undefined && context.data.session.get(sessionID)?.model?.providerID === ACCOUNT
    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => (
        <Show when={onAccount(input.sessionID)}>
          <UsageLabel context={context} usage={known()} />
        </Show>
      ),
    })
    context.ui.slot({
      append: "home.footer.status",
      render: () => <UsageLabel context={context} usage={known()} />,
    })
    context.ui.slot({ append: "app", render: () => <Commands context={context} refresh={refresh} /> })
  },
})
