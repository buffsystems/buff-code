// Virtual rows for the panes' long lists (#584): TanStack's virtual core under a React hook, the
// way the Solid file trees use @tanstack/solid-virtual — fixed-height rows in the nearest
// `.scroll-view__viewport`, the focused row kept rendered so keyboard focus survives scrolling.

import {
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
  type Range,
} from "@tanstack/virtual-core"
import { useLayoutEffect, useReducer, useRef, useState } from "react"

export function virtualScrollElement(root: HTMLElement | null | undefined) {
  if (!root?.isConnected) return null
  return root.closest<HTMLDivElement>(".scroll-view__viewport")
}

/** Keep `extra` (the focused row) rendered next to the visible range. */
export function withIndex(range: Range, extra: number) {
  const indexes = defaultRangeExtractor(range)
  if (extra < 0 || indexes.includes(extra)) return indexes
  return [...indexes, extra].sort((a, b) => a - b)
}

export function useVirtualRows(input: { count: number; key: (index: number) => string | number; keep?: number }) {
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef(input)
  latest.current = input
  const [, rerender] = useReducer((value: number) => value + 1, 0)
  const [virtualizer] = useState(
    () =>
      new Virtualizer<HTMLDivElement, HTMLDivElement>({
        count: input.count,
        getScrollElement: () => virtualScrollElement(root.current),
        estimateSize: () => 28,
        gap: 2,
        overscan: 10,
        initialRect: { width: 0, height: 600 },
        getItemKey: (index) => latest.current.key(index),
        rangeExtractor: (range) => withIndex(range, latest.current.keep ?? -1),
        scrollToFn: elementScroll,
        observeElementRect,
        observeElementOffset,
        onChange: () => rerender(),
      }),
  )
  // Rows are all one height, so the measurements depend on the count alone; the key reads the latest rows.
  if (virtualizer.options.count !== input.count) virtualizer.setOptions({ ...virtualizer.options, count: input.count })
  useLayoutEffect(() => virtualizer._didMount(), [virtualizer])
  useLayoutEffect(() => {
    virtualizer._willUpdate()
  })
  return { root, virtualizer, items: virtualizer.getVirtualItems(), total: virtualizer.getTotalSize() }
}
