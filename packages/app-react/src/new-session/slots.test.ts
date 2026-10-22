import { expect, test } from "bun:test"
import { collectDraftSlots, type DraftSlot } from "./slots"

const entry = (slot: DraftSlot["slot"], id: string, order?: number): DraftSlot => ({
  slot,
  id,
  order,
  component: () => null,
})

test("groups the draft's entries by slot in order, then id", () => {
  const slots = collectDraftSlots([
    { default: [entry("project-bar", "balance", 2), entry("project-bar", "context")] },
    { default: entry("composer", "composer") },
  ])
  expect(slots["project-bar"].map((item) => item.id)).toEqual(["context", "balance"])
  expect(slots.composer.map((item) => item.id)).toEqual(["composer"])
  expect(slots.summary).toEqual([])
})
