import { expect, test } from "bun:test"
import { adjacentHomeProject } from "./selection"

test("the next and previous project wrap around Home's order", () => {
  const list = ["/a", "/b", "/c"]
  expect(adjacentHomeProject(list, "/b", 1)).toBe("/c")
  expect(adjacentHomeProject(list, "/c", 1)).toBe("/a")
  expect(adjacentHomeProject(list, "/a", -1)).toBe("/c")
})

test("with no project shown (or a closed one) the step starts at an end", () => {
  expect(adjacentHomeProject(["/a", "/b"], undefined, 1)).toBe("/a")
  expect(adjacentHomeProject(["/a", "/b"], "/gone", -1)).toBe("/b")
  expect(adjacentHomeProject([], undefined, 1)).toBeUndefined()
})
