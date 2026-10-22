import { expect, test } from "bun:test"
import { dismissDistance } from "./mobile-drawer"

test("the sheet lets go after a quarter of its height, at most 120px", () => {
  expect(dismissDistance(200)).toBe(50)
  expect(dismissDistance(480)).toBe(120)
  expect(dismissDistance(2000)).toBe(120)
})
