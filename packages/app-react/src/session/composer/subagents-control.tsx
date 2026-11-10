// The working subagents in the composer's bottom row (#762): an icon with their count beside the
// permission mode; a click lists them, and a subagent's session opens from the list. A finished
// subagent leaves the list — it stays in the timeline's grouped calls.

import { IconButton, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@buff/ui/react"
import { Bot } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useI18n } from "../../i18n/provider"
import { sessionHref } from "../../router/routes"
import { useSession } from "../context"
import { useNavigateToSession } from "../navigate"
import { runningSubagents } from "../timeline/background"
import { useBackground } from "../timeline/background-work"

export function SubagentsControl() {
  const session = useSession()
  const i18n = useI18n()
  const navigateToSession = useNavigateToSession(session.server, session.sessionID)
  const work = useBackground(session.server, session.sessionID)
  const working = useMemo(() => runningSubagents(work), [work])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (working.length === 0) setOpen(false)
  }, [working.length])
  if (working.length === 0) return null
  const label = i18n.buff.n(working.length, "{n} subagent at work|{n} subagents at work")
  const agent = (name?: string) =>
    name ? name.slice(0, 1).toUpperCase() + name.slice(1) : i18n.t("ui.tool.agent.default")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={label}>
        <PopoverTrigger asChild>
          <IconButton
            data-action="composer-subagents"
            type="button"
            size="sm"
            aria-label={label}
            icon={
              <span className="subagents-icon">
                <Bot aria-hidden />
                <span className="subagents-icon__badge">{working.length}</span>
              </span>
            }
          />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="top" align="start" data-component="composer-subagents-list" aria-label={label} className="background-list">
        {working.map((item, index) => {
          const content = (
            <>
              <span className="shrink-0">{agent(item.agent)}</span>
              <span className="summary-row__label timeline-faint">{item.label || i18n.buff.t("Starting…")}</span>
            </>
          )
          if (!item.id)
            return (
              <div key={`starting-${index}`} className="background-list__item">
                {content}
              </div>
            )
          const id = item.id
          return (
            <a
              key={id}
              href={sessionHref(session.server.key, id)}
              data-component="composer-subagents-item"
              className="background-list__item background-list__item--link"
              onClick={(event) => {
                if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
                event.preventDefault()
                setOpen(false)
                void navigateToSession(id)
              }}
            >
              {content}
            </a>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
