import { expect, test } from "bun:test"
import { createSyncGate } from "./sync-gate"

const deferred = () => {
  const control = Promise.withResolvers<void>()
  return control
}

test("a completed key does not load again until invalidated", async () => {
  const gate = createSyncGate()
  let loads = 0
  await gate.run("project", async () => void loads++)
  await gate.run("project", async () => void loads++)
  expect(loads).toBe(1)
  gate.invalidate("project")
  await gate.run("project", async () => void loads++)
  expect(loads).toBe(2)
})

test("concurrent runs of one key share the load in flight", async () => {
  const gate = createSyncGate()
  const load = deferred()
  let loads = 0
  const first = gate.run("key", () => {
    loads++
    return load.promise
  })
  const second = gate.run("key", async () => void loads++)
  expect(gate.pending("key")).toBe(true)
  load.resolve()
  await Promise.all([first, second])
  expect(loads).toBe(1)
  expect(gate.pending("key")).toBe(false)
})

test("invalidating a started load queues one reload after it, which then completes the key", async () => {
  const gate = createSyncGate()
  const load = deferred()
  const order: string[] = []
  const first = gate.run("key", () => {
    order.push("first")
    return load.promise
  })
  gate.invalidate("key")
  const second = gate.run("key", async () => void order.push("second"))
  const third = gate.run("key", async () => void order.push("third"))
  load.resolve()
  await Promise.all([first, second, third])
  expect(order).toEqual(["first", "second"])
  await gate.run("key", async () => void order.push("fourth"))
  expect(order).toEqual(["first", "second"])
})

test("a failed load leaves the key unloaded", async () => {
  const gate = createSyncGate()
  await expect(gate.run("key", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom")
  expect(gate.has("key")).toBe(false)
  let loads = 0
  await gate.run("key", async () => void loads++)
  expect(loads).toBe(1)
})

test("complete() marks a key loaded without loading; invalidate() without a key clears all", async () => {
  const gate = createSyncGate()
  gate.complete("a")
  let loads = 0
  await gate.run("a", async () => void loads++)
  expect(loads).toBe(0)
  gate.invalidate()
  await gate.run("a", async () => void loads++)
  expect(loads).toBe(1)
})
