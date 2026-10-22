import { expect, test } from "bun:test"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { initialMessageLimit } from "./settings"

test("the Compact preset reads a first page of 40 messages, any other detail 20", () => {
  expect(initialMessageLimit(timelinePresets[2].value)).toBe(40)
  const other = timelinePresets.find((preset) => preset.id !== "compact")
  if (!other) throw new Error("no other preset")
  expect(initialMessageLimit(other.value)).toBe(20)
})
