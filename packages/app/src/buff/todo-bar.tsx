import { createSignal, Show } from "solid-js"
import { BuffTodo } from "@opencode/schema/buff-todo"
import { TodoList } from "@opencode/session-ui/buff-todo"
import { Icon } from "@opencode/ui/icon"
import { useBuffText } from "./i18n"
import "./todo-bar.css"

/**
 * Строка прогресса над полем ввода (#463), как в ZCode: «Дела 3/7 · текущее дело» — по
 * последнему списку дел в сессии; нажатие раскрывает весь список.
 */
export function BuffTodoBar(props: { items: readonly BuffTodo.Item[] | undefined }) {
  const { t } = useBuffText()
  const [open, setOpen] = createSignal(false)
  return (
    <Show when={props.items?.length ? props.items : undefined}>
      {(items) => (
        <div class="buff-todo-bar" data-component="buff-todo-bar" data-open={open()}>
          <button
            type="button"
            class="buff-todo-bar-line"
            data-action="buff-todo-toggle"
            onClick={() => setOpen(!open())}
          >
            <Icon name="checklist" size="small" />
            <span class="buff-todo-bar-text">{BuffTodo.line(items(), t)}</span>
            <Icon name="chevron-down" size="small" class="buff-todo-bar-chevron" />
          </button>
          <Show when={open()}>
            <TodoList items={items()} />
          </Show>
        </div>
      )}
    </Show>
  )
}
