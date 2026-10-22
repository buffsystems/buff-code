import { expect, test } from "bun:test"
import { batch, createStore } from "./store"

test("set replaces the snapshot and notifies subscribers once per change", () => {
  const store = createStore({ count: 0 })
  const seen: number[] = []
  const stop = store.subscribe(() => seen.push(store.get().count))
  store.set((state) => ({ count: state.count + 1 }))
  store.set((state) => ({ count: state.count + 1 }))
  stop()
  store.set((state) => ({ count: state.count + 1 }))
  expect(seen).toEqual([1, 2])
  expect(store.get().count).toBe(3)
})

test("an update that returns the same snapshot does not notify", () => {
  const store = createStore({ count: 0 })
  let calls = 0
  store.subscribe(() => calls++)
  store.set((state) => state)
  expect(calls).toBe(0)
})

test("batch defers notification to the end and notifies each touched store once", () => {
  const first = createStore({ value: 0 })
  const second = createStore({ value: 0 })
  const seen: string[] = []
  first.subscribe(() => seen.push(`first:${first.get().value}`))
  second.subscribe(() => seen.push(`second:${second.get().value}`))
  batch(() => {
    first.set(() => ({ value: 1 }))
    first.set(() => ({ value: 2 }))
    second.set(() => ({ value: 1 }))
    expect(seen).toEqual([])
  })
  expect(seen).toEqual(["first:2", "second:1"])
})

test("nested batches flush when the outermost one ends", () => {
  const store = createStore({ value: 0 })
  let calls = 0
  store.subscribe(() => calls++)
  batch(() => {
    batch(() => store.set(() => ({ value: 1 })))
    expect(calls).toBe(0)
  })
  expect(calls).toBe(1)
})
