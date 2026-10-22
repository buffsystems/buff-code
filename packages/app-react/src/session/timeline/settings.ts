// The timeline's share of the window's settings (#584): the first page a transcript reads follows
// the detail preset, as the Solid runtime sizes it. The detail itself lives in the settings model.

import { timelinePreset, type TimelineDetail } from "@opencode/session-ui/timeline/detail"

/** A transcript's first page: the Compact preset reads 40 messages, any other detail 20. */
export function initialMessageLimit(detail: TimelineDetail) {
  return timelinePreset(detail)?.id === "compact" ? 40 : 20
}
