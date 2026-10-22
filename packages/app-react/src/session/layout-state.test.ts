import { expect, test } from "bun:test"
import { nextGap, nextKept, nextSideMotion, type KeptRegions, type SideMotion } from "./layout-state"

const none: KeptRegions = { region: false, review: false, sideTerminal: false, bottomTerminal: false }
const shown = { desktop: true, side: true, review: false, sideTerminal: false, bottomTerminal: false }

test("a region once shown stays kept, until the terminal moves to the other placement", () => {
  const kept = nextKept(none, { ...shown, review: true, sideTerminal: true })
  expect(kept).toEqual({ region: true, review: true, sideTerminal: true, bottomTerminal: false })
  expect(nextKept(kept, shown)).toBe(kept)
  expect(nextKept(kept, { ...shown, side: false, bottomTerminal: true })).toEqual({
    region: true,
    review: true,
    sideTerminal: false,
    bottomTerminal: true,
  })
})

test("side regions animate for a change in the same tab only", () => {
  const start: SideMotion = {
    region: false,
    terminal: false,
    animateRegion: false,
    animateTerminal: false,
    initialized: false,
  }
  const first = nextSideMotion(start, "a", true, false)
  expect(first.animateRegion).toBe(false)
  const opened = nextSideMotion(first, "a", true, true)
  expect([opened.animateRegion, opened.animateTerminal]).toEqual([false, true])
  const other = nextSideMotion(opened, "b", false, false)
  expect([other.animateRegion, other.animateTerminal]).toEqual([false, false])
})

test("the gap closes with a delay flag and opens at once", () => {
  const open = nextGap({ gap: false, closing: false }, true)
  expect(open).toEqual({ gap: true, closing: false })
  expect(nextGap(open, false)).toEqual({ gap: false, closing: true })
  expect(nextGap(open, true)).toBe(open)
})
