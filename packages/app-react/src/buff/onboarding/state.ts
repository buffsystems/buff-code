// Whether getting to know Buff Code (#457) is done or open, kept where the Solid window keeps it.
// While it is not done or is open, sign-in does not open by itself: the introduction ends with it.

import { createStore } from "../../core/store"

const DONE_KEY = "buff.onboarding.done"

export function onboardingDone() {
  try {
    return localStorage.getItem(DONE_KEY) === "true"
  } catch {
    return true
  }
}

/** True while the introduction is open or still to come. */
export const onboardingPending = createStore(!onboardingDone())

export function markOnboardingDone() {
  onboardingPending.set(() => false)
  try {
    localStorage.setItem(DONE_KEY, "true")
  } catch {
    // Without storage the introduction shows again on the next launch.
  }
}

/** What to do on a launch: show the introduction, mark it done for a returning person, or wait. */
export function firstLaunchDecision(first: boolean | undefined, done: boolean): "show" | "skip" | "wait" | "none" {
  if (first === undefined) return "wait"
  if (done) return "none"
  return first ? "show" : "skip"
}
