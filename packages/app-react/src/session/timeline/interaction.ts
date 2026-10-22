// How one session's timeline is followed and paged (#584): the Solid window's
// createSessionTimelineInteraction and createTimelineModel as a framework-free controller. The
// virtualizer pins and unpins from scroll geometry; everything else only expresses intent.

import type { SessionMessageInfo } from "@opencode/client/promise"
import { createStore } from "../../core/store"
import type { Data } from "../../core/data/data"

const leadingTurnPageDelay = 200
const leadingTurnPageLimit = 3

export type TimelineInteractionState = {
  /** The single source of truth for "follow the newest content". */
  pinned: boolean
  scroll: { overflow: boolean; jump: boolean }
  /** The transcript's first read finished (or rows were already cached). */
  ready: boolean
  error?: unknown
}

export function createTimelineInteraction(input: { data: Data; sessionID: string }) {
  const data = input.data
  const id = input.sessionID
  const state = createStore<TimelineInteractionState>({
    pinned: true,
    scroll: { overflow: false, jump: false },
    ready: data.session.message.list(id).length > 0,
  })
  const set = (patch: Partial<TimelineInteractionState>) => state.set((current) => ({ ...current, ...patch }))
  const refs: { scroller?: HTMLDivElement; reveal?: (id: string, partID?: string) => void; toEnd?: () => void } = {}
  const frames: { scrollState?: number; fill?: number; history?: number } = {}
  const disposed = { value: false }
  const history = { requested: false }
  const scrollTarget: { element?: HTMLDivElement } = {}

  const pin = () => {
    if (!state.get().pinned) set({ pinned: true })
  }
  const unpin = () => {
    const scroller = refs.scroller
    if (!scroller || scroller.scrollHeight - scroller.clientHeight <= 1 || !state.get().pinned) return
    set({ pinned: false })
  }
  const jumpThreshold = (element: HTMLDivElement) => Math.max(400, element.clientHeight)
  const updateScrollState = (element: HTMLDivElement) => {
    const max = element.scrollHeight - element.clientHeight
    const overflow = max > 1
    const jump = overflow && max - element.scrollTop > jumpThreshold(element)
    const current = state.get().scroll
    if (current.overflow === overflow && current.jump === jump) return
    set({ scroll: { overflow, jump } })
  }
  const scheduleScrollState = (element: HTMLDivElement) => {
    scrollTarget.element = element
    if (frames.scrollState !== undefined) return
    frames.scrollState = requestAnimationFrame(() => {
      frames.scrollState = undefined
      const target = scrollTarget.element
      scrollTarget.element = undefined
      if (target) updateScrollState(target)
    })
  }

  async function loadOlder() {
    if (data.session.message.loading(id) || history.requested || !data.session.message.more(id)) return
    history.requested = true
    const before = data.session.message.list(id).length
    await data.session.message.loadMore(id).finally(() => {
      history.requested = false
    })
    const scroller = refs.scroller
    if (disposed.value || data.session.message.list(id).length <= before) return
    if (state.get().pinned || !scroller || scroller.scrollTop >= 200 || !data.session.message.more(id)) return
    if (frames.history !== undefined) cancelAnimationFrame(frames.history)
    frames.history = requestAnimationFrame(() => {
      frames.history = undefined
      onHistoryScroll()
    })
  }
  const onHistoryScroll = () => {
    const scroller = refs.scroller
    if (history.requested || data.session.message.loading(id) || state.get().pinned) return
    if (!scroller || scroller.scrollTop >= 200) return
    void loadOlder().catch(() => undefined)
  }
  // A transcript shorter than the viewport loads older pages until it scrolls or runs out.
  const fill = () => {
    if (frames.fill !== undefined) return
    frames.fill = requestAnimationFrame(() => {
      frames.fill = undefined
      const scroller = refs.scroller
      if (disposed.value || !state.get().ready || !state.get().pinned || !scroller) return
      if (data.session.message.loading(id)) return
      if (scroller.scrollHeight > scroller.clientHeight + 1 || !data.session.message.more(id)) return
      void loadOlder().catch(() => undefined)
    })
  }

  const viewport: { height: number; observer?: ResizeObserver } = { height: 0 }
  const onViewportResize = (element: HTMLDivElement) => {
    const next = element.clientHeight
    if (next === viewport.height || disposed.value) return
    const shrink = viewport.height - next
    viewport.height = next
    const gap = element.scrollHeight - element.clientHeight - element.scrollTop
    if (state.get().pinned || gap < 10 + Math.max(0, shrink)) refs.toEnd?.()
    scheduleScrollState(element)
    fill()
  }

  const resume = () => {
    pin()
    refs.toEnd?.()
    if (refs.scroller) scheduleScrollState(refs.scroller)
  }

  // A gesture inside a nested scrollable region scrolls that region, not the timeline.
  const markUserScroll = (target?: EventTarget | null) => {
    if (!refs.scroller) return
    const element = target instanceof Element ? target : undefined
    const nested = element?.closest("[data-scrollable]")
    if (nested && nested !== refs.scroller) return
  }
  const selectionInteraction = () => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) unpin()
  }

  async function load() {
    await Promise.all([data.session.message.sync(id), data.session.pending.sync(id)])
    if (disposed.value) return
    set({ ready: true })
    await enrichLeadingTurn({
      current: () => !disposed.value,
      messages: () => data.session.message.list(id),
      more: () => data.session.message.more(id),
      loading: () => data.session.message.loading(id),
      loadMore: () => data.session.message.loadMore(id),
      pause: () => new Promise((resolve) => setTimeout(resolve, leadingTurnPageDelay)),
      maxPages: leadingTurnPageLimit,
    }).catch(() => undefined)
  }

  const start = () => {
    // A view torn down in the same task (React's strict-mode remount) never starts its read.
    queueMicrotask(() => {
      if (disposed.value) return
      void load().catch((error: unknown) => {
        if (!disposed.value) set({ error, ready: true })
      })
    })
    // The pending state of older pages and the follow state decide whether to fill.
    const stop = data.state.subscribe(fill)
    return stop
  }

  return {
    state,
    start,
    pin,
    unpin,
    resume,
    fill,
    loadOlder,
    onHistoryScroll,
    scheduleScrollState,
    markUserScroll,
    selectionInteraction,
    revealMessage: (messageID: string, partID?: string) => refs.reveal?.(messageID, partID),
    scroller: () => refs.scroller,
    setScrollRef(element: HTMLDivElement | undefined) {
      if (element !== refs.scroller) {
        viewport.observer?.disconnect()
        viewport.observer = undefined
        if (element) viewport.height = element.clientHeight
        // The Solid interaction's dock observer: when the composer under the transcript grows,
        // the viewport shrinks; a transcript that followed the end (or sat at it) stays there.
        if (element && typeof ResizeObserver === "function") {
          viewport.observer = new ResizeObserver(() => onViewportResize(element))
          viewport.observer.observe(element)
        }
      }
      refs.scroller = element
      if (!element) return
      scheduleScrollState(element)
      fill()
    },
    setContentRef() {
      if (refs.scroller) scheduleScrollState(refs.scroller)
      fill()
    },
    setReveal(reveal: (messageID: string, partID?: string) => void) {
      refs.reveal = reveal
    },
    setScrollToEnd(toEnd: () => void) {
      refs.toEnd = toEnd
    },
    dispose() {
      disposed.value = true
      viewport.observer?.disconnect()
      if (frames.scrollState !== undefined) cancelAnimationFrame(frames.scrollState)
      if (frames.fill !== undefined) cancelAnimationFrame(frames.fill)
      if (frames.history !== undefined) cancelAnimationFrame(frames.history)
    },
  }
}

export type TimelineInteraction = ReturnType<typeof createTimelineInteraction>

/** Load older pages while the first loaded turn starts with assistant output whose prompt is missing. */
export async function enrichLeadingTurn(input: {
  current: () => boolean
  messages: () => SessionMessageInfo[]
  more: () => boolean
  loading: () => boolean
  loadMore: () => Promise<void>
  pause: () => Promise<unknown>
  maxPages: number
}) {
  const load = async (pages: number): Promise<void> => {
    if (!input.current() || pages >= input.maxPages || !leadingTurnNeedsParent(input.messages()) || !input.more())
      return
    await input.pause()
    if (!input.current() || !leadingTurnNeedsParent(input.messages()) || !input.more()) return
    if (input.loading()) return load(pages)
    await input.loadMore()
    return load(pages + 1)
  }
  return load(0)
}

export function leadingTurnNeedsParent(messages: SessionMessageInfo[]) {
  const assistant = messages.findIndex((message) => message.type === "assistant")
  if (assistant === -1) return false
  const boundary = messages.findIndex((message) => message.type === "user" || message.type === "shell")
  return boundary === -1 || assistant < boundary
}
