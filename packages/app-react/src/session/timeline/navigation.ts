// Moving between a session's prompts (#584): the Solid session's message navigation and hash
// anchors. `#message-<id>` reveals that prompt (loading older history until it is in), the
// previous/next commands step through the prompts and keep the address in step, and following
// the newest content again drops the anchor.

import type { SessionMessageUser } from "@opencode/client/promise"
import type { Data } from "../../core/data/data"
import type { History } from "../../router/history"
import type { TimelineInteraction } from "./interaction"
import type { TimelineProjection } from "./projection"
import type { Store } from "../../core/store"

export const messageAnchor = (id: string) => `message-${id}`

export function messageIDFromHash(hash: string | undefined) {
  return (hash ?? "").replace(/^#/, "").match(/^message-(.+)$/)?.[1]
}

export function createMessageNavigation(input: {
  data: Data
  sessionID: string
  projection: Store<TimelineProjection>
  interaction: TimelineInteraction
  history: History
}) {
  const state = { active: undefined as string | undefined, frames: new Set<number>(), disposed: false }
  const prompts = () =>
    input.projection.get().messages.filter((message): message is SessionMessageUser => message.type === "user")

  const queue = (run: () => void) => {
    const id = requestAnimationFrame(() => {
      state.frames.delete(id)
      run()
    })
    state.frames.add(id)
  }
  const cancel = () => {
    state.frames.forEach((id) => cancelAnimationFrame(id))
    state.frames.clear()
  }

  const setHash = (hash: string) => {
    const location = input.history.location.get()
    if ((location.hash ?? "") === hash) return
    input.history.navigate(location.pathname + location.search + hash, { replace: true })
  }

  // The prompt under a line 100px into the viewport, or the nearest one shown.
  const cursor = () => {
    const root = input.interaction.scroller()
    if (!root) return state.active
    const box = root.getBoundingClientRect()
    const line = box.top + 100
    const shown = [...root.querySelectorAll<HTMLElement>("[data-message-id]")].flatMap((element) => {
      const rect = element.getBoundingClientRect()
      const id = element.dataset.messageId
      return id && rect.bottom > box.top && rect.top < box.bottom ? [{ id, top: rect.top, bottom: rect.bottom }] : []
    })
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)
    if (hit) return hit.id
    return shown.toSorted((a, b) => Math.abs(a.top - line) - Math.abs(b.top - line))[0]?.id ?? state.active
  }

  const scrollToElement = (element: HTMLElement) => {
    const root = input.interaction.scroller()
    if (!root) return
    const top = element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
    root.scrollTo({ top: Math.max(0, top) })
  }

  const seek = (id: string, left = 4) => {
    input.interaction.revealMessage(id)
    const element = document.getElementById(messageAnchor(id))
    if (element) return scrollToElement(element)
    if (left > 0) queue(() => seek(id, left - 1))
  }

  const scrollToMessage = (message: SessionMessageUser) => {
    cancel()
    state.active = message.id
    input.interaction.unpin()
    seek(message.id)
    setHash(`#${messageAnchor(message.id)}`)
  }

  /** Step to the previous (-1) or next (+1) prompt; past the last one, follow the newest content. */
  const step = (offset: number) => {
    const list = prompts()
    if (list.length === 0) return
    const current = cursor()
    const base = current ? list.findIndex((message) => message.id === current) : list.length
    const target = (base === -1 ? list.length : base) + offset
    if (target < 0 || target > list.length) return
    const message = list[target]
    if (!message) return resume()
    scrollToMessage(message)
  }

  const resume = () => {
    state.active = undefined
    cancel()
    setHash("")
    input.interaction.resume()
  }

  // Reveal the anchored prompt once it is loaded, paging older history in until it is.
  const applyHash = () => {
    if (state.disposed || !input.interaction.state.get().ready) return
    const id = messageIDFromHash(input.history.location.get().hash)
    if (!id || state.active === id) return
    const message = prompts().find((item) => item.id === id)
    if (message) return queue(() => scrollToMessage(message))
    input.interaction.unpin()
    if (input.data.session.message.more(input.sessionID) && !input.data.session.message.loading(input.sessionID))
      void input.data.session.message.loadMore(input.sessionID).catch(() => undefined)
  }

  const stops = [
    input.history.location.subscribe(applyHash),
    input.projection.subscribe(applyHash),
    input.interaction.state.subscribe(() => {
      // Following the newest content again lets go of the anchor.
      if (!input.interaction.state.get().pinned || !state.active) return
      state.active = undefined
      setHash("")
    }),
  ]
  queue(applyHash)

  return {
    step,
    resume,
    dispose() {
      state.disposed = true
      cancel()
      stops.forEach((stop) => stop())
    },
  }
}
