// Find inside a timeline diff (#584): the Solid File component's file-find without Solid. Mod+F
// opens the bar of the diff last pointed at or focused, Mod+G steps through the matches, and the
// matches are drawn with the CSS Custom Highlight API inside Pierre's shadow root (its styles
// carry the `opencode-find` highlights). Unlike the Solid window it never falls back to the first
// diff on screen, so the timeline's own Find keeps Mod+F everywhere else.

import { createStore } from "../../../core/store"

export type DiffFindState = {
  open: boolean
  query: string
  index: number
  count: number
  pos: { top: number; right: number }
}

type Host = { element: () => HTMLElement | null; open: () => void; close: () => void; next: (dir: 1 | -1) => void; isOpen: () => boolean }

const hosts = new Set<Host>()
const focus: { target?: Host; current?: Host; installed: boolean } = { installed: false }

function editable(node: EventTarget | null) {
  if (!(node instanceof HTMLElement)) return false
  if (node.closest("[data-prevent-autofocus]") || node.isContentEditable) return true
  return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(node.tagName)
}

function hostOf(node: unknown) {
  if (!(node instanceof Node)) return
  return [...hosts].find((host) => {
    const element = host.element()
    return !!element?.isConnected && element.contains(node)
  })
}

function install() {
  if (focus.installed) return
  focus.installed = true
  // Pointing anywhere else gives Mod+F back to the window's own Find.
  window.addEventListener("pointerdown", (event) => (focus.target = hostOf(event.target)), { capture: true })
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented || editable(event.target) || !(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === "g") {
        const host = focus.current
        if (!host?.isOpen()) return
        event.preventDefault()
        event.stopPropagation()
        return host.next(event.shiftKey ? -1 : 1)
      }
      if (key !== "f") return
      const host =
        (focus.current?.isOpen() ? focus.current : undefined) ??
        hostOf(document.activeElement) ??
        (focus.target?.element()?.isConnected ? focus.target : undefined)
      if (!host) return
      event.preventDefault()
      event.stopPropagation()
      host.open()
    },
    { capture: true },
  )
}

function clearHighlights() {
  CSS.highlights?.delete("opencode-find")
  CSS.highlights?.delete("opencode-find-current")
}

export function createDiffFind(input: { wrapper: () => HTMLElement | null; getRoot: () => ShadowRoot | undefined }) {
  const state = createStore<DiffFindState>({ open: false, query: "", index: 0, count: 0, pos: { top: 8, right: 8 } })
  const set = (patch: Partial<DiffFindState>) => state.set((current) => ({ ...current, ...patch }))
  const refs: { input?: HTMLInputElement; hits: Range[] } = { hits: [] }

  const scan = (root: ShadowRoot, value: string) => {
    const needle = value.toLowerCase()
    return [...root.querySelectorAll<HTMLElement>("[data-content] [data-line], [data-column-content]")].flatMap((column) => {
      const hay = (column.textContent ?? "").toLowerCase()
      if (!hay.includes(needle)) return []
      const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT)
      const nodes: { node: Text; end: number }[] = []
      for (let node = walker.nextNode(), end = 0; node; node = walker.nextNode()) {
        if (!(node instanceof Text)) continue
        end += node.data.length
        nodes.push({ node, end })
      }
      const locate = (offset: number) => {
        const index = nodes.findIndex((item) => item.end >= offset)
        const item = nodes[index]!
        return { node: item.node, offset: offset - (index === 0 ? 0 : nodes[index - 1]!.end) }
      }
      const ranges: Range[] = []
      for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + value.length)) {
        const start = locate(at)
        const end = locate(at + value.length)
        const range = document.createRange()
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
        ranges.push(range)
      }
      return ranges
    })
  }

  const highlight = (index: number, scroll: boolean) => {
    clearHighlights()
    const active = refs.hits[index]
    if (active) CSS.highlights?.set("opencode-find-current", new Highlight(active))
    const rest = refs.hits.filter((_, item) => item !== index)
    if (rest.length > 0) CSS.highlights?.set("opencode-find", new Highlight(...rest))
    if (!scroll || !active) return
    const start = active.startContainer
    const element = start instanceof Element ? start : start.parentElement
    element?.scrollIntoView({ block: "center", inline: "center" })
  }

  const apply = (reset: boolean, scroll: boolean) => {
    const current = state.get()
    if (!current.open) return
    const value = current.query.trim()
    const root = input.getRoot()
    if (!value || !root) {
      refs.hits = []
      clearHighlights()
      return set({ count: 0, index: 0 })
    }
    refs.hits = scan(root, value)
    const index = refs.hits.length ? Math.min(reset ? 0 : current.index, refs.hits.length - 1) : 0
    set({ count: refs.hits.length, index })
    highlight(index, scroll)
  }

  // The bar sits at the top-end of the scroller holding the diff.
  const position = () => {
    const wrapper = input.wrapper()
    if (!wrapper) return
    const scroller = wrapper.closest<HTMLElement>("[data-scrollable]") ?? wrapper
    const rect = scroller.getBoundingClientRect()
    set({ pos: { top: Math.round(rect.top) + 4, right: Math.round(window.innerWidth - rect.right) + 8 } })
  }

  const close = () => {
    set({ open: false, query: "", count: 0, index: 0 })
    refs.hits = []
    clearHighlights()
    if (focus.current === host) focus.current = undefined
  }

  const open = () => {
    if (focus.current && focus.current !== host) focus.current.close()
    focus.current = host
    focus.target = host
    position()
    set({ open: true })
    requestAnimationFrame(() => {
      apply(false, true)
      refs.input?.focus()
      refs.input?.select()
    })
  }

  const next = (dir: 1 | -1) => {
    const current = state.get()
    if (!current.open || current.count <= 0) return
    const index = (current.index + dir + current.count) % current.count
    set({ index })
    highlight(index, true)
  }

  const host: Host = { element: input.wrapper, open, close, next, isOpen: () => state.get().open }

  return {
    state,
    open,
    close,
    next,
    setQuery(query: string) {
      set({ query, index: 0 })
      apply(true, true)
    },
    /** The diff re-rendered: find again in its new lines. */
    refresh: () => apply(true, false),
    setInput(element: HTMLInputElement | null) {
      refs.input = element ?? undefined
    },
    /** The diff was focused: Mod+F now belongs to it. */
    claim() {
      focus.target = host
    },
    mount() {
      install()
      hosts.add(host)
      return () => {
        hosts.delete(host)
        if (focus.current === host) {
          focus.current = undefined
          clearHighlights()
        }
        if (focus.target === host) focus.target = undefined
      }
    },
  }
}

export type DiffFind = ReturnType<typeof createDiffFind>
