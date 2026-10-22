import { createSignal, Show } from "solid-js"
import type { SessionTurnFailure } from "@opencode/session-ui/actions"
import { turnFailure } from "@opencode/schema/buff-turn-failure"
import { Button } from "@opencode/ui/button"
import { Card } from "@opencode/ui/card"
import { Icon } from "@opencode/ui/icon"
import { useDialog } from "@opencode/ui/context/dialog"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import { useBuffBillingDialog } from "./billing"
import { useBuffContextChoice } from "./context-chip"
import { useBuffText } from "./i18n"

/**
 * Отказ хода в ленте (#458). У апстрима это одна строка без действий; здесь — причина словами,
 * по которым понятно, что делать, и сами действия: повторить, войти заново или выбрать
 * контекст, посмотреть и скопировать отказ как он пришёл. Что написать — решает
 * `@opencode/schema/buff-turn-failure`, одинаково для окна и консоли.
 */
const FIX = {
  "sign-in": "Sign in again",
  "choose-context": "Choose context",
  "top-up": "Balance and cabinet",
  "replace-key": "Replace the key",
  "connect-provider": "Connect the provider",
} as const

export function BuffTurnFailure(props: { failure: SessionTurnFailure; onRetry: () => void | Promise<void> }) {
  const platform = usePlatform()
  const context = useBuffContextChoice()
  const billing = useBuffBillingDialog()
  const dialog = useDialog()
  const { t } = useBuffText()
  const [open, setOpen] = createSignal(false)
  const failure = () => turnFailure(props.failure, props.failure.providerID, t)

  const copy = async () => {
    await (platform.writeClipboardText?.(failure().details) ?? navigator.clipboard.writeText(failure().details))
    showToast({ title: t("Copied"), description: t("The error details are in the clipboard") })
  }
  const fix = async () => {
    if (failure().action === "sign-in") return context.signIn()
    if (failure().action === "top-up") return billing.open()
    // #562: ключ своего провайдера меняют в окне подключения — сразу на этом провайдере.
    if (failure().action === "replace-key" || failure().action === "connect-provider")
      return import("@/providers/connect/dialog").then(({ DialogConnectProvider, useProviderConnectController }) =>
        dialog.show(() => {
          const controller = useProviderConnectController()
          controller.select(props.failure.providerID)
          return <DialogConnectProvider directory={context.at().location.directory} controller={controller} />
        }),
      )
    const current = await context.rpc.get(undefined, context.at()).catch(() => null)
    await context.choose(current)
  }

  return (
    <Card variant="error" class="error-card" data-kind="session-error-card">
      <div class="flex w-full min-w-0 flex-col gap-2">
        <div class="flex w-full min-w-0 items-start gap-2">
          <Icon name="outline-hexagonal-warning" class="mt-0.5 shrink-0 text-v2-state-fg-danger" />
          <div class="min-w-0">{failure().text}</div>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <Button size="small" variant="neutral" data-action="turn-retry" onClick={() => void props.onRetry()}>
            {t("Retry")}
          </Button>
          <Show when={failure().action}>
            {(action) => (
              <Button size="small" variant="neutral" data-action="turn-fix" onClick={() => void fix()}>
                {t(FIX[action()])}
              </Button>
            )}
          </Show>
          <Button size="small" variant="ghost" data-action="turn-details" onClick={() => setOpen((value) => !value)}>
            {open() ? t("Hide details") : t("Details")}
          </Button>
          <Button size="small" variant="ghost" data-action="turn-copy" onClick={() => void copy()}>
            {t("Copy")}
          </Button>
        </div>
        <Show when={open()}>
          <pre class="m-0 whitespace-pre-wrap break-words text-12-regular text-text-weak" data-slot="turn-details">
            {failure().details}
          </pre>
        </Show>
      </div>
    </Card>
  )
}
