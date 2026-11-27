import { expect, test } from "bun:test"
import { occurrences } from "./search"

test("every place the words stand, without overlaps", () => {
  expect(occurrences("milk and milk", "milk")).toEqual([0, 9])
  expect(occurrences("aaaa", "aa")).toEqual([0, 2])
  expect(occurrences("nothing here", "milk")).toEqual([])
  expect(occurrences("anything", "")).toEqual([])
})
