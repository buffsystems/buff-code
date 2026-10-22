import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { BuffCustom } from "@opencode/schema/buff-custom"
import { BuffHook } from "@opencode/schema/buff-hook"
import { BuffTrust } from "@opencode/schema/buff-trust"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useBuffText } from "./i18n"
import { ReviewDialog } from "./settings-kit"

/**
 * Полоса над полем ввода (#446): в проекте есть хуки или команды, которые пришли из
 * репозитория и ждут подтверждения. Пока их не проверили, они не выполняются — человек должен
 * это видеть там, где работает, а не только в настройках. «Проверить» показывает каждую запись
 * и даёт подтвердить; «Скрыть» убирает полосу для этого каталога до перезапуска.
 */

const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set())

const INTRO: Record<BuffTrust.Item["kind"], string> = {
  hook: "This hook came from the project. Its command will run by itself on your machine, outside the sandbox. If the hook changes, you will be asked to confirm again.",
  command:
    "This command came from the project. Check its text: inserts like !`command` run on your machine. If the text changes, you will be asked to confirm again.",
}

function createPending() {
  const sdk = useServerSDK()
  const { t } = useBuffText()
  const location = useWorkspaceLocation()
  const custom = sdk.api.rpc(BuffCustom.Rpc)
  const hooks = sdk.api.rpc(BuffHook.Rpc)
  const at = () => ({ location: { directory: location().directory } })
  const [items, { refetch }] = createResource(
    () => (sdk.connection.status() === "connected" ? location().directory : undefined),
    () =>
      Promise.all([custom.list({ kind: "command" }, at()), hooks.list(undefined, at())]).then(
        ([commands, entries]) => BuffTrust.pending(commands, entries, t),
        () => [] as BuffTrust.Item[],
      ),
    { initialValue: [] },
  )
  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => stop.abort())
    for (const rpc of [custom, hooks])
      void (async () => {
        for await (const _ of rpc.events.subscribe("changed", { signal: stop.signal })) void refetch()
      })().catch(() => undefined)
    // #457: выключили проверку — ждать подтверждения больше нечему.
    void (async () => {
      for await (const _ of sdk.api.rpc(BuffTrust.Rpc).events.subscribe("changed", { signal: stop.signal }))
        void refetch()
    })().catch(() => undefined)
  })
  const review = (item: BuffTrust.Item) =>
    item.kind === "hook" ? hooks.review({ id: item.id }, at()) : custom.review({ kind: "command", id: item.id }, at())
  const trust = (item: BuffTrust.Item, token: string) =>
    (item.kind === "hook"
      ? hooks.trust({ id: item.id, token }, at())
      : custom.trust({ kind: "command", id: item.id, token }, at())
    ).then(
      () => undefined,
      (error: unknown) => formatServerError(error, undefined, t("Could not confirm.")),
    )
  return { items: () => items.latest ?? [], directory: () => location().directory, review, trust }
}

type Pending = ReturnType<typeof createPending>

function PendingDialog(props: { pending: Pending }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const open = async (item: BuffTrust.Item) => {
    const reviewed = await props.pending.review(item).catch((error: unknown) => {
      showToast({ title: item.title, description: formatServerError(error, undefined, t("Could not open.")) })
      return undefined
    })
    if (!reviewed) return
    void dialog.show(() => (
      <ReviewDialog
        title={t("Trust: {title}?", { title: item.title })}
        intro={t(INTRO[item.kind])}
        text={reviewed.text}
        onConfirm={async () => {
          const refusal = await props.pending.trust(item, reviewed.token)
          // Остались другие записи — возвращаемся к списку.
          if (!refusal && props.pending.items().some((other) => other !== item))
            queueMicrotask(() => void dialog.show(() => <PendingDialog pending={props.pending} />))
          return refusal
        }}
      />
    ))
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{t("Waiting for review")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-kit-form" data-component="buff-trust-list">
          <span class="text-13-regular text-text-base">
            {t(
              "This came from the project repository and runs commands on your machine by itself. Until you check an entry, it does not run.",
            )}
          </span>
          <For each={props.pending.items()}>
            {(item) => (
              <div class="flex items-center justify-between gap-3" data-trust-item={item.id}>
                <div class="buff-kit-copy">
                  <span class="text-13-medium text-text-strong">{item.title}</span>
                  <span class="buff-kit-note">{item.note}</span>
                </div>
                <Button size="small" variant="neutral" data-action="buff-trust-open" onClick={() => void open(item)}>
                  {t("Check")}
                </Button>
              </div>
            )}
          </For>
        </div>
      </DialogBody>
    </Dialog>
  )
}

export function BuffTrustStrip() {
  const dialog = useDialog()
  const { t, n } = useBuffText()
  const pending = createPending()
  const line = createMemo(() => (hidden().has(pending.directory()) ? undefined : BuffTrust.line(pending.items(), t, n)))
  return (
    <Show when={line()}>
      {(text) => (
        <div class="buff-trust-strip" data-component="buff-trust-strip">
          <Icon name="circle-ban-sign" class="shrink-0 text-icon-warning-base" />
          <span class="min-w-0 flex-1 text-13-regular text-text-base">{text()}</span>
          <Button
            size="small"
            variant="neutral"
            data-action="buff-trust-review"
            onClick={() => void dialog.show(() => <PendingDialog pending={pending} />)}
          >
            {t("Check")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            data-action="buff-trust-hide"
            onClick={() => setHidden((before) => new Set(before).add(pending.directory()))}
          >
            {t("Hide")}
          </Button>
        </div>
      )}
    </Show>
  )
}
