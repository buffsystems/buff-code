// Find in the timeline (#584): the Solid window's search controller without Solid. Matches come
// from the transcript's text, so a match in an unmounted row is still found and revealed; the
// mounted text is highlighted with the CSS Custom Highlight API.

import type { SessionMessageInfo } from "@opencode/client/promise"
import { Timeline } from "@opencode/session-ui/timeline/projection"
import { createStore, type Store } from "../../core/store"
import type { DataState } from "../../core/data/state"

export type TimelineSearchMatch = {
  messageID: string
  revealID: string
  partID: string
  occurrence: number
}

type SearchState = { value: string; active: number; visible: boolean }

const hitName = "timeline-search-hit"
const activeName = "timeline-search-hit-active"
const textSelectors = '[data-slot="text-part-body"], [data-slot="user-message-text"]'
const none: SessionMessageInfo[] = []

export function findMatches(messages: SessionMessageInfo[], query: string) {
  if (!query) return []
  const reveal = { id: "" }
  return messages.flatMap((message) => {
    if (message.type === "user" || message.type === "shell") reveal.id = message.id
    if (message.type !== "user" && message.type !== "assistant") return []
    const parts =
      message.type === "user"
        ? [{ id: `${message.id}:text:0`, content: { type: "text" as const, text: message.text } }]
        : Timeline.contentEntries(message)
    return parts.flatMap((part) => {
      if (part.content.type !== "text" || !part.content.text) return []
      const lower = part.content.text.toLowerCase()
      const starts = occurrences(lower, query)
      return starts.map((_, occurrence) => ({
        messageID: message.id,
        revealID: reveal.id,
        partID: part.id,
        occurrence,
      }))
    })
  })
}

function occurrences(text: string, query: string): number[] {
  if (!query) return []
  const at = text.indexOf(query)
  if (at === -1) return []
  return [at, ...occurrences(text.slice(at + query.length), query).map((next) => next + at + query.length)]
}

export function createTimelineSearch(input: {
  data: Store<DataState>
  sessionID: string
  scroller: () => HTMLDivElement | undefined
  reveal: (messageID: string, partID?: string) => void
  unpin: () => void
}) {
  const state = createStore<SearchState>({ value: "", active: 0, visible: false })
  const cache: { messages?: SessionMessageInfo[]; query?: string; matches: TimelineSearchMatch[] } = { matches: [] }
  const set = (patch: Partial<SearchState>) => state.set((current) => ({ ...current, ...patch }))
  const query = () => state.get().value.trim().toLowerCase()
  const matches = () => {
    const messages = input.data.get().session.message[input.sessionID] ?? none
    const current = query()
    if (cache.messages === messages && cache.query === current) return cache.matches
    cache.messages = messages
    cache.query = current
    cache.matches = findMatches(messages, current)
    return cache.matches
  }
  const activeIndex = () => {
    const active = state.get().active
    return active >= 0 && active < matches().length ? active : 0
  }
  const watch: { observer?: MutationObserver; frame?: number; input?: HTMLInputElement } = {}

  const highlight = () => {
    const root = input.scroller()
    const current = query()
    if (!root || !state.get().visible || !current) return stopHighlights()
    const match = matches()[activeIndex()]
    applyHighlights(root, current, match?.partID, match?.occurrence)
    if (watch.observer) return
    watch.observer = new MutationObserver(() => {
      if (watch.frame !== undefined) return
      watch.frame = requestAnimationFrame(() => {
        watch.frame = undefined
        const root = input.scroller()
        const match = matches()[activeIndex()]
        if (root && state.get().visible) applyHighlights(root, query(), match?.partID, match?.occurrence)
      })
    })
    watch.observer.observe(root, { childList: true, subtree: true, characterData: true })
  }
  const stopHighlights = () => {
    watch.observer?.disconnect()
    watch.observer = undefined
    if (watch.frame !== undefined) cancelAnimationFrame(watch.frame)
    watch.frame = undefined
    clearHighlights()
  }

  const scrollToMatch = (match: TimelineSearchMatch, attempt = 0) => {
    requestAnimationFrame(() => {
      const root = input.scroller()
      if (!state.get().visible || !root) return
      const active = collectRanges(root, query(), match.partID, match.occurrence).active[0]
      if (!active) {
        if (attempt < 12) scrollToMatch(match, attempt + 1)
        return
      }
      const rect = active.getBoundingClientRect()
      const box = root.getBoundingClientRect()
      const sticky = root.querySelector("[data-session-title]")
      const inset = sticky instanceof HTMLElement ? sticky.offsetHeight : 0
      root.scrollTo({ top: Math.max(0, rect.top - box.top + root.scrollTop - inset - (box.height - rect.height) / 2) })
    })
  }
  const go = (match: TimelineSearchMatch | undefined) => {
    if (!match) return
    input.unpin()
    input.reveal(match.revealID, match.partID)
    scrollToMatch(match)
  }

  return {
    state,
    activeIndex,
    count: () => matches().length,
    open() {
      set({ visible: true })
      requestAnimationFrame(() => {
        watch.input?.focus()
        watch.input?.select()
      })
    },
    close() {
      set({ value: "", active: 0, visible: false })
      watch.input?.blur()
      stopHighlights()
    },
    setValue(value: string) {
      set({ value, active: 0 })
      highlight()
      if (value.trim()) go(matches()[0])
    },
    move(delta: number) {
      const list = matches()
      if (list.length === 0) return
      const next = (activeIndex() + delta + list.length) % list.length
      set({ active: next })
      highlight()
      go(list[next])
    },
    setInput(element: HTMLInputElement | null) {
      watch.input = element ?? undefined
    },
    dispose: stopHighlights,
  }
}

export type TimelineSearch = ReturnType<typeof createTimelineSearch>

function supportsHighlights() {
  return typeof CSS !== "undefined" && typeof CSS.highlights === "object" && CSS.highlights !== null
}

function clearHighlights() {
  if (!supportsHighlights()) return
  CSS.highlights.delete(hitName)
  CSS.highlights.delete(activeName)
}

function applyHighlights(root: HTMLElement, query: string, partID: string | undefined, occurrence: number | undefined) {
  if (!supportsHighlights()) return
  const ranges = collectRanges(root, query, partID, occurrence)
  CSS.highlights.set(hitName, new Highlight(...ranges.hits))
  CSS.highlights.set(activeName, new Highlight(...ranges.active))
}

function collectRanges(root: HTMLElement, query: string, partID: string | undefined, occurrence: number | undefined) {
  const hits: Range[] = []
  const active: Range[] = []
  root.querySelectorAll<HTMLElement>(textSelectors).forEach((body) => {
    const id = body.closest("[data-timeline-part-id]")?.getAttribute("data-timeline-part-id")
    const counter = { value: 0 }
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue?.toLowerCase() ?? ""
      occurrences(text, query).forEach((at) => {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + query.length)
        const target = partID !== undefined && id === partID && counter.value === occurrence ? active : hits
        target.push(range)
        counter.value += 1
      })
    }
  })
  return { hits, active }
}

// The open timeline's search per session, so the title row in the header slot can show its Find
// bar while the timeline slot owns it.
const published = createStore<Readonly<Record<string, TimelineSearch>>>({})

export function publishSearch(key: string, search: TimelineSearch) {
  published.set((all) => ({ ...all, [key]: search }))
  return () =>
    published.set((all) => {
      if (all[key] !== search) return all
      const next = { ...all }
      delete next[key]
      return next
    })
}

export const publishedSearches = published
