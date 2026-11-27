// Find in the simple layout's transcript (#972). The whole chat is on the page there — no rows
// come and go — so the find reads the page itself: every place the words stand in a turn, in the
// order a person reads them. Same shape as the timeline's find (`timeline/search.ts`), so the
// title row's Find field serves both.

import { createStore } from "../../core/store"
import type { TimelineSearch } from "../timeline/search"

type SearchState = { value: string; active: number; visible: boolean }

const hitName = "timeline-search-hit"
const activeName = "timeline-search-hit-active"
/** A turn's words; not its buttons, nor the time beside it. */
const SKIP = "button, [role='toolbar'], time, [aria-hidden='true']"

/** Where `query` (lower case) stands in `text` (lower case), without overlaps. */
export function occurrences(text: string, query: string): number[] {
  if (!query) return []
  const found: number[] = []
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) found.push(at)
  return found
}

function ranges(root: HTMLElement, query: string): Range[] {
  if (!query) return []
  const found: Range[] = []
  root.querySelectorAll<HTMLElement>(".ui-turn").forEach((turn) => {
    const walker = document.createTreeWalker(turn, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const at of occurrences(node.nodeValue?.toLowerCase() ?? "", query)) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + query.length)
        found.push(range)
      }
    }
  })
  return found
}

function supportsHighlights() {
  return typeof CSS !== "undefined" && typeof CSS.highlights === "object" && CSS.highlights !== null
}

export type SimpleSearch = TimelineSearch & {
  /** The view is set aside: its highlights leave the page. */
  rest(): void
  /** The view is shown again: an open find paints its places anew. */
  resume(): void
}

export function createSimpleSearch(input: {
  scroller: () => HTMLElement | null
  /** Whether this view is the one on the page: the highlights are shared by all of them. */
  shown: () => boolean
}): SimpleSearch {
  const state = createStore<SearchState>({ value: "", active: 0, visible: false })
  const set = (patch: Partial<SearchState>) => state.set((current) => ({ ...current, ...patch }))
  const query = () => state.get().value.trim().toLowerCase()
  const found = () => {
    const root = input.scroller()
    return root && state.get().visible && input.shown() ? ranges(root, query()) : []
  }
  const activeIndex = () => {
    const active = state.get().active
    return active >= 0 && active < found().length ? active : 0
  }
  const watch: { observer?: MutationObserver; frame?: number; input?: HTMLInputElement } = {}
  const clear = () => {
    if (!supportsHighlights()) return
    CSS.highlights.delete(hitName)
    CSS.highlights.delete(activeName)
  }
  const paint = (list = found()) => {
    if (!supportsHighlights() || !input.shown()) return list
    const at = state.get().active
    const active = list[at >= 0 && at < list.length ? at : 0]
    CSS.highlights.set(hitName, new Highlight(...list.filter((range) => range !== active)))
    CSS.highlights.set(activeName, new Highlight(...(active ? [active] : [])))
    return list
  }
  const stop = () => {
    watch.observer?.disconnect()
    watch.observer = undefined
    if (watch.frame !== undefined) cancelAnimationFrame(watch.frame)
    watch.frame = undefined
    clear()
  }
  // An answer still being written moves the places: they are painted again as the page changes.
  const follow = () => {
    const root = input.scroller()
    if (!root || watch.observer) return
    watch.observer = new MutationObserver(() => {
      if (watch.frame !== undefined) return
      watch.frame = requestAnimationFrame(() => {
        watch.frame = undefined
        if (state.get().visible && query() && input.shown()) paint()
      })
    })
    watch.observer.observe(root, { childList: true, subtree: true, characterData: true })
  }
  const go = () => {
    if (!query()) return stop()
    follow()
    const list = paint()
    const at = state.get().active
    const active = list[at >= 0 && at < list.length ? at : 0]
    const root = input.scroller()
    if (!active || !root) return
    const rect = active.getBoundingClientRect()
    const box = root.getBoundingClientRect()
    root.scrollTo({ top: Math.max(0, rect.top - box.top + root.scrollTop - (box.height - rect.height) / 2) })
  }

  return {
    state,
    activeIndex,
    count: () => found().length,
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
      stop()
    },
    setValue(value: string) {
      set({ value, active: 0 })
      go()
    },
    move(delta: number) {
      const count = found().length
      if (count === 0) return
      const at = state.get().active
      set({ active: ((at >= 0 && at < count ? at : 0) + delta + count) % count })
      go()
    },
    rest: stop,
    resume() {
      if (state.get().visible && query()) {
        follow()
        paint()
      }
    },
    setInput(element: HTMLInputElement | null) {
      watch.input = element ?? undefined
    },
    dispose: stop,
  }
}
