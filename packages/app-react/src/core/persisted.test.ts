import { expect, test } from "bun:test"
import { createPersisted } from "./persisted"

const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial))
  return {
    items,
    storage: {
      getItem: async (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    },
  }
}
const decode = (raw: string) => {
  const value: unknown = JSON.parse(raw)
  return typeof value === "object" && value !== null && "count" in value && typeof value.count === "number"
    ? { count: value.count }
    : undefined
}

test("loads the stored value, then writes every update through", async () => {
  const backing = memory({ counter: JSON.stringify({ count: 3 }) })
  const cell = createPersisted({ storage: backing.storage, key: "counter", decode, initial: { count: 0 } })
  expect(cell.store.get()).toEqual({ count: 0 })
  await cell.ready
  expect(cell.store.get()).toEqual({ count: 3 })
  cell.set((value) => ({ count: value.count + 1 }))
  expect(backing.items.get("counter")).toBe(JSON.stringify({ count: 4 }))
})

test("an undecodable stored value keeps the initial one", async () => {
  const cell = createPersisted({
    storage: memory({ counter: "{not json" }).storage,
    key: "counter",
    decode: (raw) => {
      try {
        return decode(raw)
      } catch {
        return undefined
      }
    },
    initial: { count: 0 },
  })
  await cell.ready
  expect(cell.store.get()).toEqual({ count: 0 })
})

test("a local update made before the load finishes is not overwritten by it", async () => {
  const backing = memory({ counter: JSON.stringify({ count: 3 }) })
  const cell = createPersisted({ storage: backing.storage, key: "counter", decode, initial: { count: 0 } })
  cell.set(() => ({ count: 9 }))
  await cell.ready
  expect(cell.store.get()).toEqual({ count: 9 })
})
