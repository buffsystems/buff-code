// The to-do progress above the composer (#463): «To-dos 3/7 · the current one» from the latest
// to-do list of the session; a click unfolds the whole list.

import { BuffTodo } from "@opencode/schema/buff-todo"
import { Check, ChevronDown, Circle, CircleDot, ListChecks } from "lucide-react"
import { useState } from "react"
import { useI18n } from "../../../i18n/provider"
import { useServerData } from "../../../react/core"
import type { BuffScope } from "./scope"
import "../../../buff/bar.css"
import "./buff.css"

const ICON = { completed: Check, in_progress: CircleDot, pending: Circle } as const
const STATUS = { completed: "done", in_progress: "in progress", pending: "waiting" } as const

export function TodoBar(props: { scope: BuffScope }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const [open, setOpen] = useState(false)
  const sessionID = props.scope.sessionID
  const messages = useServerData(props.scope.server, (state) => (sessionID ? state.session.message[sessionID] : undefined))
  const items = messages ? BuffTodo.latest(messages) : undefined
  if (!items?.length) return null
  return (
    <div className="buff-bar buff-bar--stacked" data-component="buff-todo-bar" data-open={open}>
      <button type="button" className="buff-bar__line buff-bar__toggle" data-action="buff-todo-toggle" onClick={() => setOpen(!open)}>
        <ListChecks aria-hidden className="buff-bar__icon" />
        <span className="buff-bar__text">{BuffTodo.line(items, t)}</span>
        <ChevronDown aria-hidden className="buff-bar__icon buff-bar__chevron" />
      </button>
      {open && (
        <ul data-component="buff-todo-list" className="buff-todo-list">
          {items.map((item, index) => {
            const Icon = ICON[item.status]
            return (
              <li key={index} data-status={item.status}>
                <Icon aria-label={t(STATUS[item.status])} className="buff-bar__icon" />
                <span>{item.content}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
