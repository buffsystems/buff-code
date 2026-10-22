// A strip above the prompt (#446): the project has hooks or commands from the repository waiting
// for review. Until reviewed they do not run — the person should see it where they work, not only
// in settings. «Check» shows every entry to confirm; «Hide» removes the strip for this directory
// until the window restarts. Ported from the Solid window's buff/trust-strip.tsx; the session
// composer mounts it (the Solid draft shows no trust strip).

import { Button, Dialog, DialogBody } from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffCustom } from "@opencode/schema/buff-custom"
import { BuffHook } from "@opencode/schema/buff-hook"
import { BuffTrust } from "@opencode/schema/buff-trust"
import { useQuery } from "@tanstack/react-query"
import { Ban } from "lucide-react"
import { useEffect } from "react"
import type { Server } from "../../core/servers"
import { createStore } from "../../core/store"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useConnection } from "../../react/core"
import { useStore } from "../../react/use-store"
import { showToast } from "../../shell/notifications/toast"
import { ReviewDialog } from "../settings/kit"
import "../bar.css"

const hidden = createStore<ReadonlySet<string>>(new Set())

const INTRO: Record<BuffTrust.Item["kind"], string> = {
  hook: "This hook came from the project. Its command will run by itself on your machine, outside the sandbox. If the hook changes, you will be asked to confirm again.",
  command:
    "This command came from the project. Check its text: inserts like !`command` run on your machine. If the text changes, you will be asked to confirm again.",
}

function usePending(server: Server, directory: string) {
  const t = useI18n().buff.t
  const connected = useConnection(server).status === "connected"
  const api = server.api()
  const custom = api.rpc(BuffCustom.Rpc)
  const hooks = api.rpc(BuffHook.Rpc)
  const at = { location: { directory } }
  const items = useQuery({
    queryKey: ["buff-trust-pending", server.key, directory],
    enabled: connected && !!directory,
    queryFn: () =>
      Promise.all([custom.list({ kind: "command" }, at), hooks.list(undefined, at)]).then(
        ([commands, entries]) => BuffTrust.pending(commands, entries, t),
        (): BuffTrust.Item[] => [],
      ),
  })
  const refetch = items.refetch
  useEffect(() => {
    const stop = new AbortController()
    const follow = (events: AsyncIterable<unknown>) =>
      void (async () => {
        for await (const _ of events) void refetch()
      })().catch(() => undefined)
    follow(custom.events.subscribe("changed", { signal: stop.signal }))
    follow(hooks.events.subscribe("changed", { signal: stop.signal }))
    // #457: with the check turned off there is nothing left to confirm.
    follow(api.rpc(BuffTrust.Rpc).events.subscribe("changed", { signal: stop.signal }))
    return () => stop.abort()
  }, [server, directory])
  const review = (item: BuffTrust.Item) =>
    item.kind === "hook" ? hooks.review({ id: item.id }, at) : custom.review({ kind: "command", id: item.id }, at)
  const trust = (item: BuffTrust.Item, token: string) =>
    (item.kind === "hook"
      ? hooks.trust({ id: item.id, token }, at)
      : custom.trust({ kind: "command", id: item.id, token }, at)
    ).then(
      () => {
        void refetch()
        return undefined
      },
      (error: unknown) => formatServerError(error, undefined, t("Could not confirm.")),
    )
  return { items: items.data ?? [], review, trust }
}

type Pending = ReturnType<typeof usePending>

export function BuffTrustStrip(props: { server: Server; directory: string }) {
  const i18n = useI18n()
  const { t, n } = i18n.buff
  const dialog = useDialog()
  const pending = usePending(props.server, props.directory)
  const dismissed = useStore(hidden, (value) => value.has(props.directory))
  const line = dismissed ? undefined : BuffTrust.line(pending.items, t, n)
  if (!line) return null
  const list = () =>
    dialog.show((close) => <PendingDialog pending={pending} onClose={close} onReview={(item) => review(item)} />)
  const review = async (item: BuffTrust.Item) => {
    const reviewed = await pending.review(item).catch((error: unknown) => {
      showToast({ title: item.title, description: formatServerError(error, undefined, t("Could not open.")) })
      return undefined
    })
    if (!reviewed) return
    dialog.show((close) => (
      <ReviewDialog
        title={t("Trust: {title}?", { title: item.title })}
        intro={t(INTRO[item.kind])}
        text={reviewed.text}
        onClose={close}
        onConfirm={async () => {
          const refusal = await pending.trust(item, reviewed.token)
          // Other entries remain: back to the list.
          if (!refusal && pending.items.some((other) => other.id !== item.id)) queueMicrotask(list)
          return refusal
        }}
      />
    ))
  }
  return (
    <div className="buff-bar" data-component="buff-trust-strip" data-tone="warning">
      <Ban aria-hidden className="buff-bar__icon" />
      <span className="buff-bar__text">{line}</span>
      <Button size="sm" variant="outline" data-action="buff-trust-review" onClick={list}>
        {t("Check")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-action="buff-trust-hide"
        onClick={() => hidden.set((before) => new Set(before).add(props.directory))}
      >
        {t("Hide")}
      </Button>
    </div>
  )
}

function PendingDialog(props: { pending: Pending; onClose: () => void; onReview: (item: BuffTrust.Item) => void }) {
  const t = useI18n().buff.t
  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => !open && props.onClose()}
      title={t("Waiting for review")}
      closeLabel={t("Close")}
    >
      <DialogBody>
        <div className="flex flex-col gap-3" data-component="buff-trust-list">
          <span className="text-sm">
            {t(
              "This came from the project repository and runs commands on your machine by itself. Until you check an entry, it does not run.",
            )}
          </span>
          {props.pending.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3" data-trust-item={item.id}>
              <div className="flex min-w-0 flex-col">
                <span className="ui-title ui-title--sm">{item.title}</span>
                <span className="ui-hint">{item.note}</span>
              </div>
              <Button
                size="sm"
                data-action="buff-trust-open"
                onClick={() => {
                  props.onClose()
                  props.onReview(item)
                }}
              >
                {t("Check")}
              </Button>
            </div>
          ))}
        </div>
      </DialogBody>
    </Dialog>
  )
}
