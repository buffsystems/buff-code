import { beforeEach, expect, test } from "bun:test"
import { firstLaunchDecision, markOnboardingDone, onboardingDone, onboardingPending } from "./state"

beforeEach(() => localStorage.clear())

test("only a first launch shows the introduction; a returning person is marked done", () => {
  expect(firstLaunchDecision(undefined, false)).toBe("wait")
  expect(firstLaunchDecision(true, false)).toBe("show")
  expect(firstLaunchDecision(false, false)).toBe("skip")
  expect(firstLaunchDecision(true, true)).toBe("none")
})

test("done is remembered and ends the pending state", () => {
  onboardingPending.set(() => true)
  markOnboardingDone()
  expect(onboardingDone()).toBe(true)
  expect(onboardingPending.get()).toBe(false)
})
