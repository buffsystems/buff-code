import { expect, test } from "bun:test"
import { collectSlots, type SessionSlot } from "./slots"

const entry = (slot: SessionSlot["slot"], id: string, order?: number): SessionSlot => ({
  slot,
  id,
  order,
  component: () => null,
})

test("groups entries by slot in order, then id", () => {
  const slots = collectSlots([
    { default: [entry("side", "review", 1), entry("side", "files")] },
    { default: entry("timeline", "timeline") },
    { default: [entry("side", "context")] },
  ])
  expect(slots.side.map((item) => item.id)).toEqual(["context", "files", "review"])
  expect(slots.timeline.map((item) => item.id)).toEqual(["timeline"])
  expect(slots.composer).toEqual([])
})
