import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { useParams } from "@solidjs/router"
import { BuffSubscription } from "@opencode/schema/buff-subscription"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useBuffText } from "./i18n"
import "./billing.css"
import "./subscription.css"

/**
 * Подписка личного аккаунта Buff в окне (#966): самое занятое окно рядом с выбором модели и окно
 * «Расход подписки» — тариф и оба лимита: сколько израсходовано и когда обновится. То же — в
 * настройках провайдеров. Что и какими словами показать, решает `@opencode/schema/buff-subscription`,
 * как в консоли. Остаток организации (вход компании) — рядом, в `billing.tsx`.
 */

const ACCOUNT = "buff-account"
const RECHECK_MS = 5 * 60_000
const AFTER_TURN_MS = 5_000

type Known = { readonly usage?: BuffSubscription.Usage; readonly problem?: string }
// Подписка — человека, а не каталога: одно состояние на окно.
const [known, setKnown] = createSignal<Known>({})

/** Как читается самое занятое окно: спокойно, почти исчерпано, исчерпано — или подписка не действует. */
export function usageState(usage: BuffSubscription.Usage): "ok" | "low" | "exhausted" {
  const used = BuffSubscription.tightest(usage)?.usedPct ?? 0
  if (usage.plan.status !== "active" || used >= 100) return "exhausted"
  return used >= BuffSubscription.LOW_PCT ? "low" : "ok"
}

/** День на языке окна: «24.12.2026». */
export function dayLabel(iso: string, locale: string): string | undefined {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(at)
}

/** Расход подписки и способ его перечитать. */
export function createBuffSubscription(directory: Accessor<string | undefined>) {
  const sdk = useServerSDK()
  const rpc = sdk.api.rpc(BuffSubscription.Rpc)
  const refresh = async () => {
    // Подписка — человека: вне проекта (настройки) годится собственный каталог службы.
    const dir = directory()
    if (sdk.connection.status() !== "connected") return
    await rpc.get(undefined, dir ? { location: { directory: dir } } : undefined).then(
      (usage) => setKnown({ usage }),
      (error: unknown) => {
        const type = typeof error === "object" && error !== null && "type" in error ? String(error.type) : ""
        // Без входа показывать нечего; при сбое связи прежние цифры остаются.
        if (type === "signed_out") return setKnown({})
        setKnown({
          usage: known().usage,
          problem: formatServerError(error, undefined, "Could not get the subscription usage."),
        })
      },
    )
  }
  return { usage: () => known().usage, problem: () => known().problem, refresh }
}

function Summary(props: { usage: BuffSubscription.Usage }) {
  const { t, locale } = useBuffText()
  const state = () => {
    const plan = props.usage.plan
    const until = plan.activeUntil ? dayLabel(plan.activeUntil, locale()) : undefined
    return plan.status === "active" && until
      ? t("active until {date}", { date: until })
      : BuffSubscription.statusLabel(plan, t)
  }
  return (
    <div class="buff-billing-block" data-component="buff-subscription-summary" data-status={props.usage.plan.status}>
      <Show when={props.usage.login}>
        {(login) => <span class="buff-billing-label">{t("Buff account {login}", { login: login() })}</span>}
      </Show>
      <span class="buff-billing-balance" data-slot="plan">
        {BuffSubscription.planName(props.usage.plan, locale()) ?? t("Subscription")}
      </span>
      <span class="buff-billing-note" data-slot="status">
        {state()}
      </span>
      <For each={props.usage.windows}>
        {(window) => (
          <div class="buff-billing-block" data-slot="window" data-window={window.id}>
            <div class="buff-billing-row">
              <span class="buff-billing-label">{BuffSubscription.windowLabel(window.id, t)}</span>
              <span class="buff-billing-value">{BuffSubscription.usedLabel(window, t)}</span>
            </div>
            <div
              class="buff-usage-meter"
              role="progressbar"
              aria-label={BuffSubscription.windowLabel(window.id, t)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(window.usedPct, 100)}
              data-state={
                window.usedPct >= 100 ? "exhausted" : window.usedPct >= BuffSubscription.LOW_PCT ? "low" : "ok"
              }
            >
              <span style={{ width: `${Math.min(window.usedPct, 100)}%` }} />
            </div>
            <span class="buff-billing-note" data-slot="reset">
              {BuffSubscription.resetLabel(window, Date.now(), t) ?? t("not started yet")}
            </span>
          </div>
        )}
      </For>
    </div>
  )
}

const SHARED =
  "The limits are shared by the site, the phone and this computer. The subscription is managed on the Buff site."

function SubscriptionDialog(props: { subscription: ReturnType<typeof createBuffSubscription> }) {
  const { t } = useBuffText()
  return (
    <Dialog size="normal">
      <DialogHeader>
        <DialogTitle>{t("Subscription usage")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-billing" data-component="buff-subscription-dialog">
          <Show when={props.subscription.problem()}>
            {(problem) => (
              <p class="buff-billing-problem" role="alert" data-slot="problem">
                {t(problem())}
              </p>
            )}
          </Show>
          <Show
            when={props.subscription.usage()}
            fallback={<span class="buff-billing-note">{t("No subscription information yet.")}</span>}
          >
            {(usage) => <Summary usage={usage()} />}
          </Show>
          <span class="buff-billing-note">{t(SHARED)}</span>
          <div class="buff-billing-actions">
            <Button
              size="normal"
              variant="neutral"
              data-action="buff-subscription-refresh"
              onClick={() => void props.subscription.refresh()}
            >
              {t("Refresh")}
            </Button>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}

/**
 * Самое занятое окно подписки рядом с выбором модели. Чип же следит за свежестью: при появлении,
 * после каждого хода на уровне подписки и раз в несколько минут.
 */
export function BuffUsageChip() {
  const data = useData()
  const dialog = useDialog()
  const location = useWorkspaceLocation()
  const params = useParams<{ id?: string }>()
  const subscription = createBuffSubscription(() => location().directory)
  const { t } = useBuffText()
  const open = () => {
    void subscription.refresh()
    void dialog.show(() => <SubscriptionDialog subscription={subscription} />)
  }

  onMount(() => {
    const timer = setInterval(() => void subscription.refresh(), RECHECK_MS)
    onCleanup(() => clearInterval(timer))
    void subscription.refresh()
  })
  // Ход на уровне подписки закончился — расход вырос: перечитать чуть погодя.
  const spent = createMemo(() => {
    const session = params.id ? data.session.get(params.id) : undefined
    const tokens = session?.model?.providerID === ACCOUNT ? session.tokens : undefined
    return tokens ? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write : 0
  })
  let seen = spent()
  let later: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const now = spent()
    if (now === seen) return
    seen = now
    clearTimeout(later)
    later = setTimeout(() => void subscription.refresh(), AFTER_TURN_MS)
  })
  onCleanup(() => clearTimeout(later))

  const label = () => {
    const usage = subscription.usage()
    return usage ? BuffSubscription.shortLabel(usage, t) : undefined
  }
  return (
    <Show when={label()}>
      {(text) => (
        <button
          type="button"
          class="buff-balance-chip"
          data-component="buff-usage-chip"
          data-state={usageState(subscription.usage()!)}
          title={BuffSubscription.warning(subscription.usage()!, Date.now(), t) ?? t("Subscription usage")}
          onClick={open}
        >
          {text()}
        </button>
      )}
    </Show>
  )
}

/** Раздел «Подписка Buff» в настройках провайдеров: тариф и лимиты. */
export function BuffSubscriptionSection(props: { directory: string | undefined; account?: string }) {
  const { t } = useBuffText()
  const subscription = createBuffSubscription(() => props.directory)
  // Вход или выход аккаунта — повод перечитать расход.
  createEffect(() => {
    void props.account
    void subscription.refresh()
  })
  return (
    <Show when={subscription.usage()}>
      {(usage) => (
        <div class="settings-section" data-component="buff-subscription-section">
          <h3 class="settings-section-title">{t("Buff subscription")}</h3>
          <div class="buff-billing">
            <Summary usage={usage()} />
            <span class="buff-billing-note">{t(SHARED)}</span>
            <div class="buff-billing-actions">
              <Button
                size="normal"
                variant="neutral"
                data-action="buff-subscription-refresh"
                onClick={() => void subscription.refresh()}
              >
                {t("Refresh")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
