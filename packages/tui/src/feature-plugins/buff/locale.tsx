import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffLocale } from "@opencode/schema/buff-locale"
import { onCleanup, onMount } from "solid-js"
import { adoptLocale } from "./locale-state"

/**
 * Язык консоли (#472): тот, что выбран в окне, — его хранит служба Buff; пока не выбран — русский.
 * Само значение и `t`/`n` — в `locale-state.ts` (его же берут разовые команды cli).
 */

export { n, t } from "./locale-state"

/** Клиент службы — ровно то, что нужно для языка (настоящий клиент и подделка в тесте подходят оба). */
export type LocaleClient = {
  rpc(definition: typeof BuffLocale.Rpc): {
    get(input: undefined): Promise<BuffLocale.Locale>
    events: {
      subscribe(
        name: "changed",
        options: { signal: AbortSignal },
      ): AsyncIterable<{ data: { locale: BuffLocale.Locale } }>
    }
  }
}

/**
 * Следит за языком службы: спрашивает его один раз и подхватывает каждую смену, пока не сработает `stop`.
 * Общий для слота приложения и для режима mini (`buff run`), где слоты плагинов не монтируются.
 */
export function follow(client: LocaleClient, stop: AbortSignal) {
  const rpc = client.rpc(BuffLocale.Rpc)
  void rpc.get(undefined).then(
    (next) => {
      if (!stop.aborted) adoptLocale(next)
    },
    () => undefined,
  )
  void (async () => {
    for await (const event of rpc.events.subscribe("changed", { signal: stop })) adoptLocale(event.data.locale)
  })().catch(() => undefined)
}

function Follow(props: { context: Context }) {
  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => stop.abort())
    follow(props.context.client, stop.signal)
  })
  return null
}

export default Plugin.define({
  id: "buff.locale",
  setup(context) {
    context.ui.slot({ append: "app", render: () => <Follow context={context} /> })
  },
})
