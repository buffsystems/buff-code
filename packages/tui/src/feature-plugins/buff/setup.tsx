import { onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffSetup } from "@opencode/schema/buff-setup"
import { t } from "./locale"

/**
 * Режим «Настройка» в консоли (#765): `/setup [просьба]` — новая сессия режима (команда ядра);
 * переключить текущую сессию в режим — сменой агента (shift+tab), как и «План». Когда сессия
 * настройки открыта из этой переписки — командой или моделью по согласию человека, — консоль
 * переходит в её вкладку. Список сессий показывает сессии режима своей группой.
 */

function Follow(props: { context: Context; sessionID: string }) {
  const { context } = props
  const rpc = context.client.rpc(BuffSetup.Rpc)
  const stop = new AbortController()
  onCleanup(() => stop.abort())
  void (async () => {
    for await (const event of rpc.events.subscribe("opened", { signal: stop.signal })) {
      if (event.data.from !== props.sessionID) continue
      if (!context.ui.tabs.focus(event.data.session))
        context.ui.router.navigate({ type: "session", sessionID: event.data.session })
      context.ui.toast.show({ message: t("Setup continues in a new session; this one is in the next tab."), variant: "info" })
    }
  })().catch(() => undefined)
  return null
}

export default Plugin.define({
  id: "buff.setup",
  setup(context) {
    context.ui.slot({
      append: "session.composer.top",
      render: (input) => <Follow context={context} sessionID={input.sessionID} />,
    })
  },
})
