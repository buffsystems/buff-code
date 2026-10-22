// De-duplicated, invalidatable reads (#584), ported from the Solid data layer's createSync:
// one load per key until invalidated; an invalidation during a started load queues one reload
// after it, so an older response can never commit after its replacement.
export function createSyncGate() {
  // `started` is false while a reload waits for the load it replaces. Invalidations that land in
  // that window are already covered, since the reload has not read anything yet.
  type Pending = { promise: Promise<void>; invalidated: boolean; started: boolean }
  const state = new Map<string, true | Pending>()

  const start = (key: string, load: () => Promise<void>, wait?: Promise<void>) => {
    const entry: Pending = { promise: Promise.resolve(), invalidated: false, started: !wait }
    state.set(key, entry)
    const run = () => {
      entry.started = true
      return load()
    }
    entry.promise = (wait ? wait.catch(() => undefined).then(run) : run())
      .then(() => {
        if (state.get(key) === entry && !entry.invalidated) state.set(key, true)
      })
      .finally(() => {
        if (state.get(key) === entry) state.delete(key)
      })
    return entry.promise
  }

  return {
    run(key: string, load: () => Promise<void>) {
      const active = state.get(key)
      if (active === true) return Promise.resolve()
      if (!active) return start(key, load)
      if (!active.invalidated) return active.promise
      return start(key, load, active.promise)
    },
    complete(key: string) {
      if (!state.has(key)) state.set(key, true)
    },
    has: (key: string) => state.has(key),
    pending(key: string) {
      const active = state.get(key)
      return active !== undefined && active !== true
    },
    invalidate(key?: string) {
      const entries = key === undefined ? [...state] : [[key, state.get(key)] as const]
      entries.forEach(([current, active]) => {
        if (active === true) state.delete(current)
        if (active !== undefined && active !== true && active.started) active.invalidated = true
      })
    },
  }
}

export type SyncGate = ReturnType<typeof createSyncGate>
