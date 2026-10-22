import { expect, test } from "bun:test"
import type { BuffBilling } from "@opencode/schema/buff-billing"
import { billing, refreshBilling } from "./store"

const info = { org: "Acme", balanceRub: 10 } as BuffBilling.Info

test("a signed-out answer clears the numbers, a failure keeps them with the reason", async () => {
  await refreshBilling("k", "/p", async () => info)
  expect(billing.get().get("k")?.info?.org).toBe("Acme")
  await refreshBilling("k", "/p", () => Promise.reject(new Error("offline")))
  expect(billing.get().get("k")?.info?.org).toBe("Acme")
  expect(billing.get().get("k")?.problem).toBeTruthy()
  await refreshBilling("k", "/p", () => Promise.reject({ type: "signed_out" }))
  expect(billing.get().get("k")).toEqual({})
})
