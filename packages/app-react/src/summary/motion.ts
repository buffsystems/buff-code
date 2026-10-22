// The conversation's slide beside «Session details» (#584), the Solid session screen's resize
// freeze: while the window is being resized the chat panel keeps the offset it painted (an
// in-flight slide included) and lets go once resizing has been quiet for 150ms — so the
// conversation never chases the summary through every intermediate width. motion.css holds the slide.

import { useEffect } from "react"
import "./motion.css"

const SETTLE = 150

export function useSummaryResizeFreeze(chat: HTMLElement | null) {
  useEffect(() => {
    if (!chat) return
    chat.setAttribute("data-summary-resizing", "false")
    const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined }
    const settle = () => {
      timer.id = undefined
      chat.style.removeProperty("--session-summary-resize-translate")
      chat.setAttribute("data-summary-resizing", "false")
    }
    const onResize = () => {
      if (timer.id === undefined) {
        const content = chat.querySelector("[data-timeline-virtual-content]")
        chat.style.setProperty(
          "--session-summary-resize-translate",
          content ? getComputedStyle(content).translate : "none",
        )
        chat.setAttribute("data-summary-resizing", "true")
      }
      clearTimeout(timer.id)
      timer.id = setTimeout(settle, SETTLE)
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      clearTimeout(timer.id)
    }
  }, [chat])
}
