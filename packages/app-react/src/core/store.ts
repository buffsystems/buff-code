// The framework-agnostic state cell the core is built on (#584). A store holds one immutable
// snapshot; an update returns the next snapshot, sharing every untouched branch with the previous
// one. React reads it through useSyncExternalStore with a selector, so a component re-renders only
// when the slice it selected changes identity — a streaming part re-renders only its own row.

export type Readable<State> = {
  get(): State
  subscribe(listener: () => void): () => void
}

export type Store<State> = Readable<State> & {
  set(update: (state: State) => State): void
}

let depth = 0
const dirty = new Set<() => void>()

/** Run several updates, notifying each touched store once when the outermost batch ends. */
export function batch<Value>(run: () => Value) {
  depth++
  try {
    return run()
  } finally {
    depth--
    if (depth === 0) flush()
  }
}

export function createStore<State>(initial: State): Store<State> {
  let state = initial
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    get: () => state,
    set(update) {
      const next = update(state)
      if (next === state) return
      state = next
      if (depth > 0) return void dirty.add(notify)
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function flush() {
  const pending = [...dirty]
  dirty.clear()
  pending.forEach((notify) => notify())
}

/** A read-only view computed from a store, recomputed once per source snapshot. */
export function derive<Source, Value>(source: Readable<Source>, map: (state: Source) => Value): Readable<Value> {
  const cache: { entry?: { source: Source; value: Value } } = {}
  return {
    get() {
      const state = source.get()
      if (cache.entry?.source === state) return cache.entry.value
      cache.entry = { source: state, value: map(state) }
      return cache.entry.value
    },
    subscribe: source.subscribe,
  }
}

/** A read-only view computed from two stores, recomputed once per pair of snapshots. */
export function combine<First, Second, Value>(
  first: Readable<First>,
  second: Readable<Second>,
  map: (first: First, second: Second) => Value,
): Readable<Value> {
  const cache: { entry?: { first: First; second: Second; value: Value } } = {}
  return {
    get() {
      const a = first.get()
      const b = second.get()
      if (cache.entry?.first === a && cache.entry.second === b) return cache.entry.value
      cache.entry = { first: a, second: b, value: map(a, b) }
      return cache.entry.value
    },
    subscribe(listener) {
      const stops = [first.subscribe(listener), second.subscribe(listener)]
      return () => stops.forEach((stop) => stop())
    },
  }
}
