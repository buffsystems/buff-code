// The permissions mode and «Plan» new sessions start with (#450, #457), stored under the Solid
// window's keys. One store for the window: the introduction sets it by what the person does, the
// composer's mode control reads and changes it — a choice made in one shows in the other at once.

import { BuffPermissionMode } from "@opencode/schema/buff-permission-mode"
import { createStore } from "../core/store"

const MODE_KEY = "buff.permission-mode"
const PLAN_KEY = "buff.plan-by-default"

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Without storage the choice lasts until the window restarts.
  }
}

/** The mode chosen last: new sessions start with it. By default — as before modes existed. */
export const preferredMode = createStore<BuffPermissionMode.Mode>(
  BuffPermissionMode.MODES.find((mode) => mode.value === read(MODE_KEY))?.value ?? "full",
)

export function preferMode(mode: BuffPermissionMode.Mode) {
  preferredMode.set(() => mode)
  write(MODE_KEY, mode)
}

export function preferForNewSessions(mode: BuffPermissionMode.Mode, plan: boolean) {
  preferMode(mode)
  write(PLAN_KEY, String(plan))
}

/** A new session starts in «Plan» when the introduction chose so (#457). */
export const planByDefault = () => read(PLAN_KEY) === "true"
