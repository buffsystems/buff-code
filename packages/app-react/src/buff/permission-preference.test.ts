import { beforeEach, expect, test } from "bun:test"
import { planByDefault, preferForNewSessions, preferMode, preferredMode } from "./permission-preference"

beforeEach(() => localStorage.clear())

test("the introduction's choice reaches the composer's mode at once, without a reload", () => {
  const seen: string[] = []
  const stop = preferredMode.subscribe(() => seen.push(preferredMode.get()))
  preferForNewSessions("ask", true)
  stop()
  expect(seen).toEqual(["ask"])
  expect(preferredMode.get()).toBe("ask")
  expect(localStorage.getItem("buff.permission-mode")).toBe("ask")
  expect(planByDefault()).toBe(true)
})

test("a mode chosen in the composer is remembered under the Solid window's key", () => {
  preferMode("full")
  expect(preferredMode.get()).toBe("full")
  expect(localStorage.getItem("buff.permission-mode")).toBe("full")
  expect(planByDefault()).toBe(false)
})
