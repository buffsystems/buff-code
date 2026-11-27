import { expect, test } from "bun:test"
import { BuffSubscription } from "@opencode/schema/buff-subscription"
import { dayLabel, refreshSubscription, subscription, usageState } from "./store"

const usage = (windows: unknown[], status = "active") =>
  BuffSubscription.usage({ subscription: { status, plan_name: "Базовый", plan_name_en: "Basic" }, windows }, "ivan")

test("a signed-out answer clears the numbers, a failure keeps them with the reason", async () => {
  const known = usage([{ id: "5h", used_pct: 12, reset_at: null }])
  await refreshSubscription("k", async () => known)
  expect(subscription.get().get("k")?.usage).toEqual(known)
  await refreshSubscription("k", () => Promise.reject(new Error("offline")))
  expect(subscription.get().get("k")?.usage).toEqual(known)
  expect(subscription.get().get("k")?.problem).toBeTruthy()
  await refreshSubscription("k", () => Promise.reject({ type: "signed_out" }))
  expect(subscription.get().get("k")).toEqual({})
})

test("the chip's tone follows the busiest window and the subscription's state", () => {
  expect(usageState(usage([{ id: "5h", used_pct: 12, reset_at: null }]))).toBe("ok")
  expect(
    usageState(
      usage([
        { id: "5h", used_pct: 12, reset_at: null },
        { id: "week", used_pct: 93, reset_at: null },
      ]),
    ),
  ).toBe("low")
  expect(usageState(usage([{ id: "5h", used_pct: 100, reset_at: null }]))).toBe("exhausted")
  expect(usageState(usage([], "grace"))).toBe("exhausted")
})

test("the day the subscription lasts until reads in the window's language", () => {
  expect(dayLabel("2026-12-24T22:59:59+00:00", "ru-RU")).toBe("24.12.2026")
  expect(dayLabel("2026-12-24T22:59:59+00:00", "en-US")).toBe("12/24/2026")
  expect(dayLabel("soon", "ru-RU")).toBeUndefined()
})
