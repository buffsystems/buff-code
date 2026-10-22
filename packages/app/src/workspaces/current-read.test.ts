import { describe, expect, test } from "bun:test"
import { readWhileCurrent } from "./current-read"

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))
// The retries run on timers; a loaded machine can take longer than a fixed sleep to get through
// them (this test failed 1 in ~12 runs), so wait for the expected calls instead.
async function until(done: () => boolean) {
  const deadline = Date.now() + 2_000
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1))
}

describe("readWhileCurrent", () => {
  test("retries a failed read until it lands", async () => {
    const calls: number[] = []
    readWhileCurrent(
      async () => {
        calls.push(calls.length)
        if (calls.length === 1) throw new Error("500")
      },
      { delay: 0 },
    )
    await until(() => calls.length >= 2)
    await settle()
    expect(calls).toEqual([0, 1])
  })

  test("gives up after the attempts, like a location read", async () => {
    const calls: number[] = []
    readWhileCurrent(
      async () => {
        calls.push(calls.length)
        throw new Error("500")
      },
      { delay: 0 },
    )
    await until(() => calls.length >= 3)
    await settle()
    expect(calls).toEqual([0, 1, 2])
  })

  test("a stopped read is not retried", async () => {
    const gate = Promise.withResolvers<void>()
    const calls: number[] = []
    const stop = readWhileCurrent(
      async () => {
        calls.push(calls.length)
        await gate.promise
        throw new Error("500")
      },
      { delay: 0 },
    )
    stop()
    gate.resolve()
    await settle()
    expect(calls).toEqual([0])
  })
})
