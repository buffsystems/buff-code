import { useRef, useSyncExternalStore } from "react"
import type { Readable } from "../core/store"

/**
 * Subscribe a component to a slice of a core store. The component re-renders only when the
 * selected value changes — by identity, or by `equal` for derived values (filtered lists, objects
 * built in the selector), which would otherwise be new on every read.
 */
export function useStore<State, Selected>(
  store: Readable<State>,
  select: (state: State) => Selected,
  equal: (previous: Selected, next: Selected) => boolean = Object.is,
) {
  const cache = useRef<{ state: State; select: (state: State) => Selected; value: Selected } | undefined>(undefined)
  const snapshot = () => {
    const state = store.get()
    const cached = cache.current
    if (cached && cached.state === state && cached.select === select) return cached.value
    const next = select(state)
    const value = cached && equal(cached.value, next) ? cached.value : next
    cache.current = { state, select, value }
    return value
  }
  return useSyncExternalStore(store.subscribe, snapshot, snapshot)
}

/** Equal when both are the same arrays or plain objects item by item, one level deep. */
export function shallowEqual<Value>(previous: Value, next: Value) {
  if (Object.is(previous, next)) return true
  if (Array.isArray(previous) && Array.isArray(next))
    return previous.length === next.length && previous.every((item, index) => Object.is(item, next[index]))
  if (!isRecord(previous) || !isRecord(next)) return false
  const keys = Object.keys(previous)
  return keys.length === Object.keys(next).length && keys.every((key) => Object.is(previous[key], next[key]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
