import { expect, test } from "bun:test"
import { frameStats, longStats } from "./sampler"

test("frames give the rate, the worst frame and the janky ones", () => {
  const frames = [16, 16, 48, 20].map((dur, index) => ({ at: index * 20, dur }))
  const stats = frameStats(frames)
  expect(Math.round(stats.fps ?? 0)).toBe(40)
  expect(stats.gap).toBe(48)
  expect(stats.jank).toBe(1)
  expect(frameStats([]).fps).toBeUndefined()
})

test("long tasks count their time beyond 50ms", () => {
  expect(
    longStats([
      { at: 0, dur: 80 },
      { at: 1, dur: 120 },
    ]),
  ).toEqual({ block: 100, count: 2, max: 120 })
})
