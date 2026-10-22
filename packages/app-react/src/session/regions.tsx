// What the layout tells the panes about their regions (#584): whether the review and the terminal
// are shown, kept mounted while hidden, animated, and how tall — and the two surfaces the panes
// render in, the Solid window's review aside and TerminalSurface, so the frame's geometry and
// motion stay the layout's.

import { createContext, use, useRef, type ReactNode } from "react"

export type ReviewRegion = {
  /** Shown: the review is open on a desktop. */
  opened: boolean
  /** Rendered: shown, or hidden and kept mounted. */
  present: boolean
  /** The terminal sits under the review in the side column. */
  stacked: boolean
  /** A resize is under way: no width transition. */
  resizing: boolean
}

export type TerminalRegion = {
  opened: boolean
  present: boolean
  desktop: boolean
  /** Across the bottom on a desktop (or on a phone): its own height, animated. */
  stacked: boolean
  /** In the side column: no frame of its own, it fills its slot. */
  fill: boolean
  framed: boolean
  height: string
  contentHeight: string
  animate: boolean
  resizing: boolean
  /** The review toggle floats over the terminal's top-end corner. */
  reserveReviewToggle: boolean
}

export type SessionRegions = { review: ReviewRegion; terminal: TerminalRegion }

const closed: SessionRegions = {
  review: { opened: false, present: false, stacked: false, resizing: false },
  terminal: {
    opened: false,
    present: false,
    desktop: true,
    stacked: false,
    fill: false,
    framed: true,
    height: "0px",
    contentHeight: "100%",
    animate: false,
    resizing: false,
    reserveReviewToggle: false,
  },
}

const RegionsContext = createContext<SessionRegions>(closed)

export function SessionRegionsProvider(props: { value: SessionRegions; children?: ReactNode }) {
  return <RegionsContext value={props.value}>{props.children}</RegionsContext>
}

const sameFields = <Value extends object>(a: Value, b: Value) =>
  (Object.keys(a) as (keyof Value)[]).every((key) => a[key] === b[key])

/** The same object while nothing in it changed, so the panes re-render only for a real change. */
export function useStableRegions(value: SessionRegions) {
  const kept = useRef(value)
  const same = sameFields(kept.current.review, value.review) && sameFields(kept.current.terminal, value.terminal)
  if (!same) kept.current = value
  return kept.current
}

/** The regions the layout shows the panes in. */
export function useSessionRegions() {
  return use(RegionsContext)
}

/** The review and files aside: present while kept, hidden (aria and inert) while closed. */
export function ReviewSurface(props: { label: string; children?: ReactNode }) {
  const region = useSessionRegions().review
  return (
    <aside
      id="review-panel"
      aria-label={props.label}
      aria-hidden={!region.opened}
      inert={!region.opened}
      data-component="session-side-panel"
      data-stacked={region.stacked || undefined}
      data-resizing={region.resizing || undefined}
      className="session-review-surface"
      style={{ width: region.present || region.opened ? "auto" : "0px" }}
    >
      {(region.present || region.opened) && (
        <div data-slot="session-review-content" className="session-review-surface__content">
          {props.children}
        </div>
      )}
    </aside>
  )
}

/** The terminal's aside: its height, its size animation and its content box. */
export function TerminalSurface(props: { label: string; children?: ReactNode }) {
  const region = useSessionRegions().terminal
  const animated = region.animate && !region.resizing && (!region.desktop || region.stacked)
  return (
    <aside
      id="terminal-panel"
      data-component="terminal-panel"
      data-opened={region.opened}
      data-size-animated={animated}
      data-framed={(region.desktop && region.framed) || undefined}
      data-present={region.present || region.opened || undefined}
      data-stacked={!region.desktop || region.stacked || undefined}
      role="region"
      aria-label={props.label}
      aria-hidden={!region.opened}
      inert={!region.opened}
      className="terminal-surface"
      style={{ height: region.height, ["--terminal-panel-height" as string]: region.contentHeight }}
    >
      <div
        data-slot="terminal-panel-content"
        className="terminal-surface__content"
        data-closed={!region.opened || undefined}
        style={{ height: region.contentHeight }}
      >
        {props.children}
      </div>
    </aside>
  )
}
