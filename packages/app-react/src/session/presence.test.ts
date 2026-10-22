import { expect, test } from "bun:test"
import { nextPresence, type PresenceState } from "./presence"

const start = (show: boolean, identity = "a"): PresenceState => ({ identity, show, animate: false, present: show })

test("a change within one identity animates, and the region stays present while it leaves", () => {
  const opened = nextPresence(start(false), true, "a")
  expect(opened).toEqual({ identity: "a", show: true, animate: true, present: true })
  const closing = nextPresence(opened, false, "a")
  expect(closing).toEqual({ identity: "a", show: false, animate: true, present: true })
})

test("another identity shows its own state at once, without animating", () => {
  const opened = nextPresence(start(false), true, "a")
  expect(nextPresence(opened, false, "b")).toEqual({ identity: "b", show: false, animate: false, present: false })
  expect(nextPresence(start(false), true, "b")).toEqual({ identity: "b", show: true, animate: false, present: true })
})

test("nothing changed keeps the same state", () => {
  const state = start(true)
  expect(nextPresence(state, true, "a")).toBe(state)
})
