// The request map left of the timeline (#465), ported from the Solid window's buff/query-map.tsx:
// a tick per request of the person, the one in view marked; on hover — the request and the start
// of its answer; a click goes to that turn. Shown from two requests on and a chat panel at least
// 864 px wide. The list is never cut: the column scrolls.

import { Tooltip } from "@buff/ui/react"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { BuffQueryMap } from "@opencode/schema/buff-query-map"
import { useEffect, useMemo, useRef, useState } from "react"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import { useHistory } from "../../router/router"
import { useSession } from "../context"
import { messageAnchor } from "../timeline/navigation"
import "./query-map.css"

const WIDE = 864
const none: readonly SessionMessageInfo[] = []

export function QueryMap() {
  const { server, sessionID } = useSession()
  const history = useHistory()
  const t = useI18n().buff.t
  const messages = useServerData(server, (state) => state.session.message[sessionID] ?? none)
  const queries = useMemo(() => BuffQueryMap.queries(messages), [messages])
  const root = useRef<HTMLElement>(null)
  const [current, setCurrent] = useState<string>()
  const [wide, setWide] = useState(true)

  // The current request: the last one whose start is above the middle of the visible timeline.
  useEffect(() => {
    const track = () => {
      const panel = root.current?.closest<HTMLElement>('[data-slot="session-chat-panel"]')
      if (!panel) return
      const box = panel.getBoundingClientRect()
      setWide(box.width >= WIDE)
      const line = box.top + box.height / 2
      const passed = [...panel.querySelectorAll<HTMLElement>("[data-message-id]")].filter(
        (element) => element.getBoundingClientRect().top <= line,
      )
      setCurrent(passed.at(-1)?.dataset.messageId)
    }
    track()
    const timer = setInterval(track, 400)
    return () => clearInterval(timer)
  }, [])

  const jump = (id: string) => {
    const location = history.location.get()
    history.navigate(`${location.pathname}${location.search}#${messageAnchor(id)}`, { replace: true })
  }

  if (!BuffQueryMap.shown(messages)) return null
  return (
    <nav ref={root} className="buff-query-map" data-component="buff-query-map" data-hidden={!wide || undefined} aria-label={t("Request map")}>
      {queries.map((query) => {
        const words = BuffQueryMap.preview(query, t)
        return (
          <Tooltip
            key={query.id}
            side="right"
            variant="popover"
            content={
              <div className="buff-query-map-preview">
                <span className="buff-query-map-title">{words.title}</span>
                <span className="buff-query-map-query">{words.query}</span>
                <span className="buff-query-map-answer">{words.answer}</span>
              </div>
            }
          >
            <button
              type="button"
              className="buff-query-map-tick"
              data-action="buff-query-jump"
              data-active={current === query.id || undefined}
              data-running={query.running || undefined}
              aria-label={t("Go to request {index}", { index: query.index })}
              onClick={() => jump(query.id)}
            />
          </Tooltip>
        )
      })}
    </nav>
  )
}
