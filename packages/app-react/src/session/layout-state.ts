// The session frame's moving parts (#584), as in the Solid window's session screen: a resize in
// progress, the measured panel row, the viewport's height, which regions stay mounted while hidden,
// and which region changes animate. Pure transitions are exported for tests.

import { useEffect, useLayoutEffect, useRef, useState } from "react"

/** A drag on a divider: transitions stop while it lasts, and for a moment after a key step. */
export function useSizing() {
  const [active, setActive] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const stop = () => {
      window.clearTimeout(timer.current)
      timer.current = undefined
      setActive(false)
    }
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("blur", stop)
    return () => {
      window.clearTimeout(timer.current)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("blur", stop)
    }
  }, [])
  const start = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    setActive(true)
  }
  return {
    active,
    start,
    touch() {
      start()
      timer.current = window.setTimeout(() => setActive(false), 120)
    },
  }
}

/** The element's size, kept current; undefined until first measured. */
export function useElementSize(element: HTMLElement | null) {
  const [size, setSize] = useState<{ width?: number; height?: number }>({})
  useLayoutEffect(() => {
    if (!element) return
    const read = () => {
      const width = element.offsetWidth
      const height = element.offsetHeight
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return size
}

const viewportHeight = () => window.visualViewport?.height ?? window.innerHeight

export function useViewportHeight() {
  const [height, setHeight] = useState(viewportHeight)
  useEffect(() => {
    const sync = () => setHeight(viewportHeight())
    window.addEventListener("resize", sync)
    window.visualViewport?.addEventListener("resize", sync)
    return () => {
      window.removeEventListener("resize", sync)
      window.visualViewport?.removeEventListener("resize", sync)
    }
  }, [])
  return height
}

/** Regions once shown stay mounted (hidden) so switching back neither remounts nor reloads them. */
export type KeptRegions = { region: boolean; review: boolean; sideTerminal: boolean; bottomTerminal: boolean }

export function nextKept(
  kept: KeptRegions,
  input: { desktop: boolean; side: boolean; review: boolean; sideTerminal: boolean; bottomTerminal: boolean },
): KeptRegions {
  const sidePlacement = input.desktop && input.side
  const next = {
    region: kept.region || input.review,
    review: kept.review || input.review,
    sideTerminal: sidePlacement && (kept.sideTerminal || input.sideTerminal),
    bottomTerminal: !sidePlacement && (kept.bottomTerminal || input.bottomTerminal),
  }
  const same = (Object.keys(next) as (keyof KeptRegions)[]).every((key) => next[key] === kept[key])
  return same ? kept : next
}

/** The side column's two regions animate only when they change within one tab. */
export type SideMotion = {
  key?: string
  region: boolean
  terminal: boolean
  animateRegion: boolean
  animateTerminal: boolean
  initialized: boolean
}

export function nextSideMotion(previous: SideMotion, key: string | undefined, region: boolean, terminal: boolean) {
  if (previous.initialized && previous.key === key && previous.region === region && previous.terminal === terminal)
    return previous
  const sameTab = previous.initialized && previous.key === key
  return {
    key,
    region,
    terminal,
    animateRegion: sameTab && previous.region !== region,
    animateTerminal: sameTab && previous.terminal !== terminal,
    initialized: true,
  }
}

/** The gap between review and terminal opens with them and closes after their slide. */
export function nextGap(previous: { gap: boolean; closing: boolean }, stacked: boolean) {
  if (previous.gap === stacked) return previous
  return { gap: stacked, closing: !stacked }
}

/** State that follows inputs during render: `next` returns the same object when nothing changed. */
export function useFollow<State>(initial: () => State, next: (state: State) => State) {
  const [state, setState] = useState(initial)
  const following = next(state)
  if (following !== state) setState(following)
  return [following, setState] as const
}
