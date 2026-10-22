import { expect, test } from "bun:test"
import { withIndex } from "./virtual"

test("withIndex keeps the focused row rendered beside the visible range", () => {
  const range = { startIndex: 10, endIndex: 12, overscan: 0, count: 100 }
  expect(withIndex(range, -1)).toEqual([10, 11, 12])
  expect(withIndex(range, 11)).toEqual([10, 11, 12])
  expect(withIndex(range, 3)).toEqual([3, 10, 11, 12])
})
