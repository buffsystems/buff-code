import { createResource, onCleanup, onMount } from "solid-js"
import { BuffSessionMarks as Marks } from "@opencode/schema/buff-session-marks"
import { BuffSide } from "@opencode/schema/buff-side"
import type { ServerCtx } from "@/runtime/server/runtime"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import { useBuffText } from "./i18n"

/**
 * Отметки сессий в окне (#452): закрепление, архив, группы — их хранит ядро, они одни на окно и
 * консоль. Один источник для колонки сессий и для экрана Home (архивные и побочные диалоги там
 * не показываются).
 */
export function createSessionMarks(ctx: () => ServerCtx | undefined) {
  const { t } = useBuffText()
  const rpc = () => ctx()?.sdk.api.rpc(Marks.Rpc)
  const [state, { mutate, refetch }] = createResource(
    () => (ctx()?.sdk.connection.status() === "connected" ? ctx()!.sdk.scope : undefined),
    () =>
      rpc()!
        .get(undefined)
        .catch(() => Marks.EMPTY),
    { initialValue: Marks.EMPTY },
  )
  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => stop.abort())
    void (async () => {
      const events = rpc()?.events.subscribe("changed", { signal: stop.signal })
      if (events) for await (const _ of events) void refetch()
    })().catch(() => undefined)
    // Новый побочный диалог (#470) уходит из списков сразу, как в ZCode.
    void (async () => {
      const events = ctx()?.sdk.api.rpc(BuffSide.Rpc).events.subscribe("opened", { signal: stop.signal })
      if (events) for await (const _ of events) void refetch()
    })().catch(() => undefined)
  })
  return {
    state: () => state.latest ?? Marks.EMPTY,
    change: (input: Marks.Change) =>
      rpc()
        ?.change(input)
        .then(mutate, (error: unknown) => {
          // Причину отказа ядро пишет английской строкой схемы — она переводится здесь (#472).
          showToast({
            title: t("Sessions"),
            description: t(formatServerError(error, undefined, "Could not save.")),
          })
        }),
  }
}
