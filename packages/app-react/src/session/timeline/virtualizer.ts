// The session timeline's virtualizer (#584): the Solid window's createTimelineVirtualizer as an
// imperative controller over TanStack's virtual-core (patched like the Solid side). It owns the
// scroll element, row measurement and every anchoring decision — the anchored prepend of history,
// the 64px gap above the composer, the hidden cold mount that reveals at the latest message — and
// publishes only what the view paints: the virtual items, the total size and the touch fold.

import {
  defaultRangeExtractor,
  elementScroll,
  observeElementRect,
  Virtualizer,
  type Range,
  type VirtualItem,
} from "@tanstack/virtual-core"
import { TimelineRow } from "@opencode/session-ui/timeline/projection"
import { createStore, type Store } from "../../core/store"
import { selectedRowKeys } from "@opencode/app/react-reuse/timeline-virtual-items"
import { observeElementOffsetReconnectAware } from "./observe-element-offset"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "./scroll-keys"
import type { TimelineProjection } from "./projection"

export const fallbackItemSize = 60
export const bottomGap = 64
const pendingMarkdown = '[data-component="markdown"]:not([data-markdown-ready])'
// Distance from the bottom that counts as "at the end". Deliberately tight: a collapse clamps
// exactly to the end, while a one-pixel nudge upward is a deliberate move away from it.
const endEpsilon = 0.5
const upwardKeys = new Set(["up", "page-up", "home"])

export type Disclosure = Readonly<Record<string, boolean | undefined>>

type CacheEntry = {
  measurements: VirtualItem[]
  toolOpen: Disclosure
  patchGroupKeys: Map<string, string>
  presentationKey?: string
}

// Measurements and row disclosure of recently shown sessions, so a revisited tab paints at once.
const cache = new Map<string, CacheEntry>()

export type TimelineVirtualizerInput = {
  sessionKey: string
  presentationKey: string
  projection: Store<TimelineProjection>
  active: () => boolean
  showHeader: () => boolean
  isDesktop: () => boolean
  /** True while the timeline follows the newest content. Drives every anchoring decision. */
  pinned: () => boolean
  canRenderImmediately?: (row: TimelineRow.TimelineRow, disclosure: Disclosure) => boolean
  onPin: () => void
  onUnpin: () => void
  onUserScroll: (target?: EventTarget | null) => void
  onHistoryScroll: () => void
  onScheduleScrollState: (element: HTMLDivElement) => void
  setScrollRef: (element: HTMLDivElement | undefined) => void
  setContentRef: (element: HTMLDivElement) => void
}

export type TimelineView = {
  items: VirtualItem[]
  totalSize: number
  /** Rows and the sizer use the opposite translation while native touch scrolling keeps its offset. */
  scrollAdjustment: number
  /** The hidden pinned first mount: rows stay invisible until the latest message is in place. */
  cold: boolean
}

export function createTimelineVirtualizer(input: TimelineVirtualizerInput) {
  const active = () => input.active()
  const topOffset = () => (input.showHeader() ? 64 : input.isDesktop() ? 0 : 16)
  const rows = () => input.projection.get().rows
  const entry = cache.get(input.sessionKey)
  const cached = entry?.presentationKey === input.presentationKey ? entry : undefined
  const initialMeasurements = cached?.measurements
  const coldBottomMount = !initialMeasurements?.length && input.pinned()
  const disclosure = createStore<Disclosure>(cached?.toolOpen ?? {})
  const patchGroupKeys = cached?.patchGroupKeys ?? new Map<string, string>()
  const rendering = { initialTail: coldBottomMount, scrollAdjustment: 0 }
  const view = createStore<TimelineView>({ items: [], totalSize: 0, scrollAdjustment: 0, cold: coldBottomMount })

  const knownKeys = new Set(rows().map(TimelineRow.key))
  const addedKeys = new Set<string>()
  const keyState: { rows?: TimelineRow.TimelineRow[]; keys: string[]; getItemKey: (index: number) => string } = {
    keys: [],
    getItemKey: (index) => `removed:${index}`,
  }
  // The key function changes identity only when the row keys do, which is what makes the
  // virtualizer re-anchor; a row that only changed content keeps its measurements.
  const getItemKey = () => {
    const current = rows()
    if (keyState.rows === current) return keyState.getItemKey
    keyState.rows = current
    const keys = current.map(TimelineRow.key)
    if (keys.length === keyState.keys.length && keys.every((key, index) => key === keyState.keys[index]))
      return keyState.getItemKey
    keys
      .filter((key) => !knownKeys.has(key))
      .forEach((key) => {
        knownKeys.add(key)
        addedKeys.add(key)
      })
    keyState.keys = keys
    keyState.getItemKey = (index) => keys[index] ?? `removed:${index}`
    return keyState.getItemKey
  }
  const rangeExtractor = () => {
    const projection = input.projection.get()
    const id = projection.activeMessageID
    const last = id ? (projection.messageLastRowIndex.get(id) ?? -1) : -1
    const initialTail = rendering.initialTail && input.pinned()
    return (range: Range) => {
      // Batch a bounded cheap suffix, but stop before unknown/large content.
      // A large tail still mounts alone before estimates expose earlier history.
      const start = Math.max(0, range.startIndex - 2)
      const open = disclosure.get()
      const boundary = initialTail
        ? rows()
            .slice(start, range.count)
            .findLastIndex(
              (row) =>
                !(
                  row._tag === "AssistantPart" &&
                  row.group.type === "context" &&
                  row.group.refs.length <= 64 &&
                  !open[`context:${row.group.key}`]
                ) && !input.canRenderImmediately?.(row, open),
            )
        : -1
      const first = Math.min(range.count - 1, start + boundary + 1)
      const indexes = initialTail
        ? Array.from({ length: range.count - first }, (_, index) => first + index)
        : defaultRangeExtractor({ ...range, overscan: 2 })
      const selected = refs.root
        ? selectedRowKeys(refs.root, window.getSelection()).map((key) => keyState.keys.indexOf(key))
        : []
      return [...new Set([...indexes, ...(last < 0 ? [] : [last]), ...selected])]
        .sort((a, b) => a - b)
        .filter((index) => index >= 0 && index < range.count)
    }
  }

  const measuredElements = new WeakSet<Element>()
  const refs: { root?: HTMLDivElement; content?: HTMLDivElement } = {}
  const touch = {
    start: undefined as number | undefined,
    target: null as EventTarget | null,
    nested: false,
    scrolling: false,
    adjustment: 0,
  }
  const scroll = { top: 0, max: 0, pointerHeld: false }
  const reporters: {
    offset?: (offset: number, scrolling: boolean) => void
    rect?: (rect: { width: number; height: number }) => void
  } = {}
  const cold = { pending: coldBottomMount, settleQueued: false, batchingSizes: false }
  const observers: { content?: MutationObserver; viewport?: ResizeObserver } = {}

  const publish = () => {
    const current = view.get()
    const items = virtualizer.getVirtualItems()
    const totalSize = virtualizer.getTotalSize()
    if (
      current.items === items &&
      current.totalSize === totalSize &&
      current.scrollAdjustment === rendering.scrollAdjustment &&
      current.cold === cold.pending
    )
      return
    view.set(() => ({ items, totalSize, scrollAdjustment: rendering.scrollAdjustment, cold: cold.pending }))
  }
  const setScrollAdjustment = (value: number) => {
    rendering.scrollAdjustment = value
    publish()
  }

  const options = () => ({
    count: rows().length,
    getScrollElement: () => refs.root ?? null,
    observeElementRect: (instance: Virtualizer<HTMLDivElement, HTMLDivElement>, callback: (rect: { width: number; height: number }) => void) => {
      reporters.rect = callback
      return observeElementRect(instance, (rect) => {
        if (active()) callback(rect)
      })
    },
    // Route navigation detaches and reattaches the scroll element, which drops its offset.
    observeElementOffset: (
      instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
      callback: (offset: number, scrolling: boolean) => void,
    ) => {
      reporters.offset = (offset, scrolling) => {
        if (!active()) return
        // Range selection uses the logical offset; rows and the sizer the opposite translation.
        const logicalOffset = offset + rendering.scrollAdjustment
        callback(rendering.scrollAdjustment ? Math.max(0, logicalOffset) : offset, scrolling)
        // Reconcile both start boundaries in one native write. Gradually clamping row
        // translations lets the compositor paint between corrections and makes the content
        // oscillate at the top.
        const root = refs.root
        if (
          rendering.scrollAdjustment !== 0 &&
          root &&
          (logicalOffset <= 0 || offset <= 0 || (touch.start !== undefined && offset <= root.clientHeight))
        )
          flushTouchAdjustment()
        if (!scrolling && touch.start === undefined) finishTouchScroll()
        settleColdBottom()
      }
      return observeElementOffsetReconnectAware(instance, reporters.offset, () => {
        if (!active()) return
        refs.content?.querySelectorAll<HTMLDivElement>("[data-index]").forEach(virtualizer.measureElement)
        if (input.pinned()) virtualizer.scrollToEnd()
        settleColdBottom()
      })
    },
    initialOffset: () => (input.pinned() ? Number.MAX_SAFE_INTEGER : 0),
    initialMeasurementsCache: initialMeasurements,
    estimateSize: () => fallbackItemSize,
    // A newly observed element gets a real ResizeObserver box before paint. Reuse its snapshot on
    // attachment, but later explicit measurements must read layout so deferred or rewrapped
    // content cannot keep stale, clipped heights (TanStack/virtual#1183).
    measureElement: (
      element: HTMLDivElement,
      observed: ResizeObserverEntry | undefined,
      instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
    ) => {
      const known = () =>
        instance.itemSizeCache.get(instance.options.getItemKey(instance.indexFromElement(element)))
      if (!active() || !element.isConnected) return known() ?? fallbackItemSize
      const initial = !measuredElements.has(element)
      measuredElements.add(element)
      const box = observed?.borderBoxSize[0]
      if (box) return Math.round(box.blockSize)
      if (initial) {
        const size = known()
        if (size !== undefined || cold.pending) return size ?? fallbackItemSize
      }
      return element.offsetHeight
    },
    scrollToFn: (
      offset: number,
      scrollOptions: { adjustments?: number; behavior?: ScrollBehavior },
      instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
    ) => {
      if (!active()) return
      if (cold.batchingSizes && input.pinned()) return
      rendering.scrollAdjustment = 0
      if (refs.content) refs.content.style.height = `${instance.getTotalSize()}px`
      elementScroll(offset, scrollOptions, instance)
      publish()
    },
    getItemKey: getItemKey(),
    anchorTo: input.pinned() ? ("end" as const) : ("start" as const),
    followOnAppend: input.pinned(),
    scrollEndThreshold: 80,
    // Empty projections still need the bottom spacer for running status.
    scrollMargin: rows().length > 0 ? topOffset() : 0,
    paddingEnd: bottomGap,
    rangeExtractor: rangeExtractor(),
    onChange: (instance: Virtualizer<HTMLDivElement, HTMLDivElement>) => {
      instance._willUpdate()
      publish()
    },
  })

  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>(options())
  const resizeItem = virtualizer.resizeItem
  const pendingSizes = new Map<number, { key: string; size: number }>()
  const resize = { scheduled: false }
  // Read the whole measurement delivery before committing row sizes. Otherwise each row can
  // render and force layout before the next is measured.
  virtualizer.resizeItem = (index, size) => {
    if (!active()) return
    const row = rows()[index]
    if (!row) return
    const key = TimelineRow.key(row)
    if ((virtualizer.itemSizeCache.get(key) ?? fallbackItemSize) === size) {
      pendingSizes.delete(index)
      return
    }
    pendingSizes.set(index, { key, size })
    if (resize.scheduled) return
    resize.scheduled = true
    queueMicrotask(flushSizes)
  }
  const flushSizes = () => {
    resize.scheduled = false
    if (!pendingSizes.size) return
    const sizes = [...pendingSizes]
    pendingSizes.clear()
    if (!active()) return
    // The hidden pinned mount needs one bottom write after the whole batch, not a
    // layout-forcing scroll adjustment for every measured row.
    cold.batchingSizes = cold.pending && input.pinned()
    sizes.forEach(([index, value]) => {
      const row = rows()[index]
      if (!row || TimelineRow.key(row) !== value.key) return
      resizeItem(index, value.size)
      // TanStack recalculates its range after each resize. Advance the logical fold before
      // deciding whether the next row needs anchoring.
      if (!touch.adjustment) return
      rendering.scrollAdjustment += touch.adjustment
      touch.adjustment = 0
      const root = refs.root
      if (root) reporters.offset?.(root.scrollTop, virtualizer.isScrolling)
    })
    cold.batchingSizes = false
    publish()
    if (cold.pending) pinColdBottom()
    settleColdBottom()
    if (cold.pending || !input.pinned()) return
    const root = refs.root
    // Reopening a settled scroll-to-end operation can fight subsequent keyboard scrolling.
    if (root && Math.abs(root.scrollHeight - root.clientHeight - root.scrollTop) > endEpsilon)
      virtualizer.scrollToEnd()
  }
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
    // Prepended rows can resize more than once as deferred content mounts. Keep compensating
    // while they remain entirely above the visible content fold.
    const first = instance.range?.startIndex
    const adjust = addedKeys.has(String(item.key))
      ? item.end <= (instance.scrollOffset ?? 0) + instance.scrollAdjustments + instance.options.scrollMargin
      : first !== undefined && item.index < first
    if (!touch.scrolling || input.pinned()) return adjust
    // iOS defers native scroll writes until momentum ends. Keep the same visual anchor now,
    // rather than moving rows now and snapping the viewport back later.
    if (adjust) touch.adjustment += delta
    return false
  }

  function finishTouchScroll() {
    touch.scrolling = false
    flushTouchAdjustment()
  }

  function prepareNavigation() {
    if (touch.start === undefined) touch.scrolling = false
    flushTouchAdjustment()
  }

  function flushTouchAdjustment() {
    const adjustment = rendering.scrollAdjustment
    const root = refs.root
    if (!adjustment || !root) return
    // Transfer the translation into the native offset in the same paint.
    rendering.scrollAdjustment = 0
    if (refs.content) refs.content.style.height = `${virtualizer.getTotalSize()}px`
    elementScroll(Math.max(0, root.scrollTop + adjustment), {}, virtualizer)
    publish()
  }

  const pinColdBottom = () => {
    if (!active()) return
    const root = refs.root
    if (!input.pinned() || !refs.content || !root) return
    // scrollToEnd computes its target from the DOM, not the new size cache.
    refs.content.style.height = `${virtualizer.getTotalSize()}px`
    if (Math.abs(root.scrollHeight - root.clientHeight - root.scrollTop) > endEpsilon) virtualizer.scrollToEnd()
    // Report after core size adjustments finish so they cannot apply a delta twice. This avoids
    // waiting a frame for the native scroll event.
    if (virtualizer.scrollOffset !== root.scrollTop) reporters.offset?.(root.scrollTop, false)
  }
  const pendingMeasurements = () => {
    const items = virtualizer.getVirtualItems()
    return (
      (rows().length > 0 && items.length === 0) ||
      items.some((item) => !virtualizer.elementsCache.get(item.key)?.isConnected)
    )
  }
  const settleColdBottom = () => {
    if (!active() || !cold.pending || cold.settleQueued) return
    cold.settleQueued = true
    queueMicrotask(() => {
      cold.settleQueued = false
      const root = refs.root
      const content = refs.content
      if (!cold.pending || !content?.isConnected || !root) return
      if (content.querySelector(pendingMarkdown)) return
      if (!root.clientHeight) return
      // Markdown can finish before ResizeObserver delivers its new box. The normal measureElement
      // path skips reads while scrolling; this gate needs current boxes before expanding the
      // estimated range or revealing it.
      virtualizer.elementsCache.forEach((element) => {
        if (element.isConnected) virtualizer.resizeItem(virtualizer.indexFromElement(element), element.offsetHeight)
      })
      if (pendingSizes.size || pendingMeasurements()) return
      pinColdBottom()
      if (input.pinned() && Math.abs(root.scrollHeight - root.clientHeight - root.scrollTop) > 1) return
      // The scroll event must update the range before newly exposed rows can reveal.
      if (root.scrollHeight > root.clientHeight && Math.abs((virtualizer.scrollOffset ?? 0) - root.scrollTop) > 1)
        return
      if (rendering.initialTail) {
        rendering.initialTail = false
        sync()
        settleColdBottom()
        return
      }
      if (pendingSizes.size || pendingMeasurements() || content.querySelector(pendingMarkdown)) return
      cold.pending = false
      observers.content?.disconnect()
      observers.viewport?.disconnect()
      content.style.removeProperty("visibility")
      publish()
    })
  }

  /** Push the current rows and follow state into the virtualizer, as Solid's computed does. */
  function sync() {
    virtualizer.setOptions(options())
    virtualizer._willUpdate()
    publish()
  }

  const stopProjection = input.projection.subscribe(sync)
  const stopDisclosure = disclosure.subscribe(sync)

  // Upward input is the one intent geometry cannot recover: nudging up while still a pixel from
  // the end must stop following, even though the resulting position still looks like the end.
  const onWheel = (event: WheelEvent) => {
    input.onUserScroll(event.target)
    if (event.deltaY < 0) input.onUnpin()
  }

  const onTouchStart = (event: TouchEvent) => {
    clearTouchTarget()
    input.onUserScroll(event.target)
    touch.scrolling = true
    touch.start = event.touches[0]?.clientY
    const root = refs.root
    const nested = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-scrollable]") : null
    touch.nested = !!nested && nested !== root && nested.scrollHeight > nested.clientHeight
    // Native touch events keep their original target, even when streaming or virtualization
    // detaches it. Listen there instead of relying on bubbling.
    touch.target = event.target
    touch.target?.addEventListener("touchmove", onTouchMove, { passive: true })
    touch.target?.addEventListener("touchend", onTouchEnd, { passive: true })
    touch.target?.addEventListener("touchcancel", onTouchEnd, { passive: true })
    if (root) reporters.offset?.(root.scrollTop, virtualizer.isScrolling)
  }

  const onTouchMove = (event: Event) => {
    if (!(event instanceof TouchEvent)) return
    const current = event.touches[0]?.clientY
    if (current === undefined || touch.start === undefined) return
    const previous = touch.start
    touch.start = current
    // A retained target can outlive its whole session view. Only the active timeline may change
    // the shared follow state; release still cleans up below.
    if (!active()) return
    // Dragging the content downward reveals earlier messages.
    if (current <= previous) return
    // A nested scrollport owns the intent. If it chains into the timeline at a boundary, the
    // resulting native timeline scroll below will unpin instead.
    if (touch.nested) return
    input.onUnpin()
  }

  const onTouchEnd = () => {
    clearTouchTarget()
    touch.start = undefined
    if (!virtualizer.isScrolling) finishTouchScroll()
  }

  function clearTouchTarget() {
    touch.target?.removeEventListener("touchmove", onTouchMove)
    touch.target?.removeEventListener("touchend", onTouchEnd)
    touch.target?.removeEventListener("touchcancel", onTouchEnd)
    touch.target = null
  }

  // Drag-selecting past the edge and dragging the scrollbar both scroll without a wheel or key,
  // so a held pointer is what separates those from the virtualizer's own measurement adjustments.
  const onPointerDown = (event: PointerEvent) => {
    input.onUserScroll(event.target)
    scroll.pointerHeld = true
  }
  const releasePointer = () => {
    scroll.pointerHeld = false
  }
  window.addEventListener("pointerup", releasePointer)
  window.addEventListener("pointercancel", releasePointer)

  const onKeyDown = (event: KeyboardEvent) => {
    const key = scrollKey(event)
    const root = event.currentTarget
    if (!key || !(root instanceof HTMLElement)) return
    if (!isScrollKeyTarget(event.target, key)) return
    if (scrollKeyOwner(root, event.target, key) !== root) return
    input.onUserScroll(root)
    if (upwardKeys.has(key)) input.onUnpin()
  }

  // Following resumes by arriving at the end, either by scrolling there or by content shrinking
  // under a viewport that was already there. Merely resting near the end is not enough, otherwise
  // a later scroll would overwrite an upward intent expressed a pixel short of the bottom.
  const onScroll = (event: Event) => {
    const root = event.currentTarget
    if (!active() || !(root instanceof HTMLDivElement)) return
    const previousTop = scroll.top
    const previousMax = scroll.max
    scroll.top = root.scrollTop
    scroll.max = root.scrollHeight - root.clientHeight
    const atEnd = scroll.max - scroll.top <= endEpsilon
    const arrived = scroll.top > previousTop + endEpsilon || scroll.max < previousMax
    if (scroll.max <= 1 || (atEnd && arrived)) input.onPin()
    else if ((scroll.pointerHeld || touch.scrolling) && scroll.top < previousTop - endEpsilon) input.onUnpin()
    settleColdBottom()
    input.onScheduleScrollState(root)
    input.onHistoryScroll()
  }

  /** Attach the viewport. TanStack owns anchoring; browser scroll anchoring would fight it. */
  function bindRoot(root: HTMLDivElement | null) {
    if (!root || root === refs.root) return
    root.style.overflowAnchor = "none"
    refs.root = root
    scroll.top = root.scrollTop
    scroll.max = root.scrollHeight - root.clientHeight
    if (active()) input.setScrollRef(root)
    observers.viewport?.observe(root)
    sync()
    settleColdBottom()
  }

  function bindContent(content: HTMLDivElement | null) {
    if (!content || content === refs.content) return
    refs.content = content
    if (active()) input.setContentRef(content)
  }

  /** The view mounted: start the hidden cold mount's watchers and the virtualizer itself. */
  function mount() {
    const stop = virtualizer._didMount()
    virtualizer._willUpdate()
    publish()
    if (cold.pending && refs.content) {
      observers.content = new MutationObserver(settleColdBottom)
      observers.content.observe(refs.content, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-markdown-ready"],
      })
      observers.viewport = new ResizeObserver(settleColdBottom)
      if (refs.root) observers.viewport.observe(refs.root)
      settleColdBottom()
    }
    return stop
  }

  /** The view became the active one: publish its refs and restore the offset. */
  function activate() {
    if (!active()) return
    const root = refs.root
    if (root) input.setScrollRef(root)
    if (refs.content) input.setContentRef(refs.content)
    queueMicrotask(() => {
      if (!active() || !root?.isConnected) return
      // A detached view can miss its nonzero ResizeObserver delivery. Publish its real viewport
      // before restoring the offset and admitting rows.
      reporters.rect?.({ width: root.offsetWidth, height: root.offsetHeight })
      if (input.pinned()) virtualizer.scrollToEnd()
      reporters.offset?.(root.scrollTop, false)
      settleColdBottom()
    })
  }

  function measureRow(element: HTMLDivElement | null) {
    virtualizer.measureElement(element)
  }

  /** A row whose content finished rendering (markdown, a diff) asks to be measured next frame. */
  function remeasure(element: HTMLDivElement) {
    if (active() && element.isConnected) virtualizer.measureElement(element)
  }

  // The optimistic row can paint before ResizeObserver corrects the tail estimates. Measure the
  // mounted tail and pin it in this render's microtask instead.
  function pinAddedUserMessage(key: string, index: () => number, element: HTMLDivElement) {
    const row = input.projection.get().rowByKey.get(key)
    if (row?._tag !== "UserMessage" || !addedKeys.has(key) || !input.pinned() || cold.pending) return
    queueMicrotask(() => {
      const content = refs.content
      if (!input.pinned() || !content?.isConnected) return
      virtualizer.elementsCache.forEach((item) => {
        if (item.isConnected) virtualizer.resizeItem(virtualizer.indexFromElement(item), item.offsetHeight)
      })
      virtualizer.resizeItem(index(), element.offsetHeight)
      content.style.height = `${virtualizer.getTotalSize()}px`
      virtualizer.scrollToEnd()
    })
  }

  function revealMessage(id: string, partID?: string) {
    if (!active()) return
    const partIndex = partID
      ? rows().findIndex(
          (row) => row._tag === "AssistantPart" && row.group.type === "part" && row.group.ref.partID === partID,
        )
      : -1
    const index = partIndex >= 0 ? partIndex : input.projection.get().messageRowIndex.get(id)
    if (index === undefined) return
    prepareNavigation()
    virtualizer.scrollToIndex(index, { align: "center" })
  }

  function scrollToEnd() {
    if (!active() || !refs.root?.isConnected) return
    prepareNavigation()
    input.onPin()
    virtualizer.scrollToEnd()
  }

  function dispose() {
    stopProjection()
    stopDisclosure()
    pendingSizes.clear()
    clearTouchTarget()
    window.removeEventListener("pointerup", releasePointer)
    window.removeEventListener("pointercancel", releasePointer)
    cache.delete(input.sessionKey)
    cache.set(input.sessionKey, {
      measurements: virtualizer.takeSnapshot(),
      toolOpen: disclosure.get(),
      patchGroupKeys,
      presentationKey: input.presentationKey,
    })
    while (cache.size > 16) cache.delete(cache.keys().next().value!)
    cold.pending = false
    observers.content?.disconnect()
    observers.viewport?.disconnect()
    if (active()) input.setScrollRef(undefined)
  }

  return {
    view,
    virtualizer,
    topOffset,
    coldBottomMount,
    addedKeys,
    disclosure: {
      store: disclosure,
      patchGroupKeys,
      value: (key: string) => disclosure.get()[key],
      set: (key: string, open: boolean) => disclosure.set((state) => (state[key] === open ? state : { ...state, [key]: open })),
    },
    sync,
    mount,
    activate,
    bindRoot,
    bindContent,
    measureRow,
    remeasure,
    pinAddedUserMessage,
    revealMessage,
    scrollToEnd,
    prepareNavigation,
    setScrollAdjustment,
    handlers: { onWheel, onTouchStart, onPointerDown, onKeyDown, onScroll },
    dispose,
  }
}

export type TimelineVirtualizer = ReturnType<typeof createTimelineVirtualizer>
