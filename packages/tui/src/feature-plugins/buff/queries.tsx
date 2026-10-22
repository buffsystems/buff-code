import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { t } from "./locale"

/**
 * Карта запросов в консоли (#465): «Перейти к запросу» в палитре и `/queries` открывают список
 * запросов сессии с началом ответа (`/timeline`); движение по списку прокручивает ленту.
 */

function Commands(props: { context: Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.queries",
        title: t("Buff: go to a request"),
        group: "Buff",
        palette: true as const,
        slash: { name: "queries" },
        run: () => props.context.keymap.dispatch("session.timeline"),
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "buff.queries",
  setup(context) {
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})
