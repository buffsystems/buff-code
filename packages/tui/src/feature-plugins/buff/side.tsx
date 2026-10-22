import { onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffSide } from "@opencode/schema/buff-side"
import { t } from "./locale"

/**
 * Побочный диалог в консоли (#464): `/side [вопрос]` — ответвление этой сессии; служба сообщает
 * «открыт», консоль переходит в его вкладку. Вернуться — вкладкой основной сессии.
 * Быстрый одноразовый ответ без продолжения — по-прежнему `/btw`.
 */

function Follow(props: { context: Context; sessionID: string }) {
  const { context } = props
  const rpc = context.client.rpc(BuffSide.Rpc)
  const stop = new AbortController()
  onCleanup(() => stop.abort())
  void (async () => {
    for await (const event of rpc.events.subscribe("opened", { signal: stop.signal })) {
      if (event.data.session !== props.sessionID) continue
      if (!context.ui.tabs.focus(event.data.side.id))
        context.ui.router.navigate({ type: "session", sessionID: event.data.side.id })
      context.ui.toast.show({
        message: t("{title} is open. The main session is in the next tab.", { title: BuffSide.title(event.data.side.n, t) }),
        variant: "info",
      })
    }
  })().catch(() => undefined)
  return null
}

export default Plugin.define({
  id: "buff.side",
  setup(context) {
    // Только при открытой сессии: события нужны лишь для неё.
    context.ui.slot({
      append: "session.composer.top",
      render: (input) => <Follow context={context} sessionID={input.sessionID} />,
    })
  },
})
