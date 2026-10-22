// Animated presence for the session's regions (#584), the React twin of the Solid window's
// createAnimatedPresence over solid-presence: a region stays mounted while its exit animation runs,
// and animates only for a change within one tab — switching tabs shows the other tab's state at once.

import { useLayoutEffect, useState } from "react"

export type PresenceState = {
  identity: unknown
  show: boolean
  /** A change happened within this identity: the region's presence animations run. */
  animate: boolean
  /** Shown, or hidden with its exit animation still running. */
  present: boolean
}

/** The next presence after `show` or `identity` changed. */
export function nextPresence(previous: PresenceState, show: boolean, identity: unknown): PresenceState {
  if (previous.show === show && previous.identity === identity) return previous
  const same = previous.identity === identity
  const animate = same && (previous.animate || previous.show !== show)
  return { identity, show, animate, present: show || (animate && previous.present) }
}

/**
 * `show` animated per `identity`. `element` is the region whose exit animation (started by
 * `data-opened="false"`) is awaited before it leaves; without one running it leaves at once.
 */
export function useAnimatedPresence(show: boolean, identity: unknown, element: HTMLElement | null) {
  const [state, setState] = useState<PresenceState>(() => ({ identity, show, animate: false, present: show }))
  const next = nextPresence(state, show, identity)
  if (next !== state) setState(next)
  const exiting = !next.show && next.present

  useLayoutEffect(() => {
    if (!exiting) return
    const leave = () => setState((current) => (current.show ? current : { ...current, present: false }))
    const name = element ? getComputedStyle(element).animationName : "none"
    if (!element || name === "none") return leave()
    // Only the exit animation's own end: the entry it interrupted ends (cancelled) on the way.
    const end = (event: AnimationEvent) => {
      if (event.target === element && event.animationName === name) leave()
    }
    element.addEventListener("animationend", end)
    element.addEventListener("animationcancel", end)
    return () => {
      element.removeEventListener("animationend", end)
      element.removeEventListener("animationcancel", end)
    }
  }, [exiting, element])

  return next
}
