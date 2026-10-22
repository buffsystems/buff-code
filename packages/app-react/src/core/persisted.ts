import type { PlatformStorage } from "../platform/platform"
import { createStore } from "./store"

/**
 * A store backed by one key of a platform storage namespace (#584): it starts from `initial`,
 * takes the stored value once loaded (unless updated locally meanwhile) and writes every update
 * through as JSON — the layout the Solid window's persisted() uses, so both windows share it.
 */
export function createPersisted<Value>(input: {
  storage: PlatformStorage
  key: string
  decode: (raw: string) => Value | undefined
  initial: Value
}) {
  const store = createStore(input.initial)
  const local = { changed: false }
  const ready = Promise.resolve()
    .then(() => input.storage.getItem(input.key))
    .then((raw) => {
      if (raw === null || local.changed) return
      const value = input.decode(raw)
      if (value !== undefined) store.set(() => value)
    })
    .catch(() => undefined)
  return {
    store,
    ready,
    set(update: (value: Value) => Value) {
      local.changed = true
      const before = store.get()
      store.set(update)
      if (store.get() !== before) void input.storage.setItem(input.key, JSON.stringify(store.get()))
    },
  }
}

export type Persisted<Value> = ReturnType<typeof createPersisted<Value>>
