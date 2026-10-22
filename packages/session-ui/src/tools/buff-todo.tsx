import { For } from "solid-js"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffTodo } from "@opencode/schema/buff-todo"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { BasicTool } from "../components/basic-tool"
import { registerTool } from "./tool-renderer"
import "./buff-todo.css"

/**
 * Список дел Buff (#463): строки с отметкой «готово / в работе / ждёт» — карточка вызова
 * `todo_update` в ленте и раскрытая строка прогресса над полем ввода в окне.
 */

const ICON = { completed: "check", in_progress: "status-active", pending: "status" } as const
const STATUS = { completed: "done", in_progress: "in progress", pending: "waiting" } as const

// Язык окна приходит через i18n интерфейса; строки Buff — из каталога Buff (#472).
function useBuffT(): BuffI18n.T {
  const i18n = useI18n()
  return (text, params) => BuffI18n.t(BuffI18n.locale(i18n.locale()), text, params)
}

export function TodoList(props: { items: readonly BuffTodo.Item[] }) {
  const t = useBuffT()
  return (
    <ul data-component="buff-todo-list">
      <For each={props.items}>
        {(item) => (
          <li data-status={item.status}>
            <Icon name={ICON[item.status]} size="small" aria-label={t(STATUS[item.status])} />
            <span>{item.content}</span>
          </li>
        )}
      </For>
    </ul>
  )
}

registerTool({
  name: BuffTodo.TOOL,
  render(props) {
    const t = useBuffT()
    const items = () => BuffTodo.fromInput(props.input) ?? []
    const state = () => BuffTodo.progress(items())
    return (
      <BasicTool
        {...props}
        icon="checklist"
        hasContent={items().length > 0}
        trigger={{
          title: t("To-dos"),
          subtitle: `${state().done}/${state().total}${state().current ? ` · ${state().current}` : ""}`,
        }}
      >
        <TodoList items={items()} />
      </BasicTool>
    )
  },
})
