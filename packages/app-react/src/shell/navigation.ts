// The window's own back and forward (#584): the titlebar history the Solid window keeps, over the
// router — a desktop window has no browser buttons.

import { applyPath, backPath, forwardPath, type TitlebarHistory } from "@opencode/app/react-reuse/titlebar-history"
import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "../router/router"

export function useWindowHistory() {
  const location = useLocation()
  const navigate = useNavigate()
  const history = useRef<TitlebarHistory>({ stack: [], index: 0, action: undefined })
  const url = location.pathname + location.search
  useEffect(() => {
    history.current = applyPath(history.current, { url })
  }, [url])
  const go = (next: { state: TitlebarHistory; to: { url: string } } | undefined) => {
    if (!next) return
    history.current = next.state
    navigate(next.to.url)
  }
  return {
    back: () => go(backPath(history.current)),
    forward: () => go(forwardPath(history.current)),
  }
}
