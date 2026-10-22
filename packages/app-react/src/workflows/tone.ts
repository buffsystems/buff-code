// The badge tone of a workflow, run, phase or step state (#448): the Solid page's tints in
// @buff/ui's status vocabulary.

import type { BadgeTone } from "@buff/ui/react"

const tones: Record<string, BadgeTone> = {
  errored: "crit",
  failed: "crit",
  waiting: "warn",
  approval: "warn",
  stopped: "warn",
  running: "info",
  primary: "info",
  completed: "ok",
  done: "ok",
}

export const stateTone = (state: string): BadgeTone => tones[state] ?? "neutral"
