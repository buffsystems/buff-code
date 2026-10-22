import { Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffTodo } from "@opencode/schema/buff-todo"
import { t } from "./locale"
import { todoLines } from "./todo-view"

/**
 * Список дел в консоли (#463): строка «Дела 3/7 · текущее дело» над полем ввода по последнему
 * списку в сессии и /todos — весь список. Ведёт список модель инструментом `todo_update`.
 */

const latest = (context: Context, sessionID: string) => BuffTodo.latest(context.data.session.message.list(sessionID))

function Progress(props: { context: Context; sessionID: string }) {
  const items = () => latest(props.context, props.sessionID)
  return (
    <Show when={items()?.length ? items() : undefined}>
      {(list) => (
        <box paddingLeft={2} paddingRight={2}>
          <text fg={props.context.theme.text.muted}>☰ {BuffTodo.line(list(), t)} · /todos</text>
        </box>
      )}
    </Show>
  )
}

function Commands(props: { context: Context }) {
  const { context } = props
  const current = () => {
    const route = context.ui.router.current()
    return route.type === "session" ? route.sessionID : undefined
  }
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.todos",
        title: t("Buff: to-do list"),
        group: "Buff",
        palette: true as const,
        slash: { name: "todos" },
        run: () => {
          const session = current()
          const items = session ? latest(context, session) : undefined
          if (!items?.length)
            return context.ui.toast.show({ message: t("This session has no to-do list yet."), variant: "info" })
          void context.ui.dialog.alert({ title: BuffTodo.line(items, t), message: todoLines(items).join("\n") })
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "buff.todo",
  setup(context) {
    context.ui.slot({
      append: "session.composer.top",
      render: (input) => <Progress context={context} sessionID={input.sessionID} />,
    })
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})
