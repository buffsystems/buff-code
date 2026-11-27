import { expect, test } from "bun:test"
import { BuffPlan } from "@opencode/schema/buff-plan"
import { isPlanApproval } from "./plan-approval"

const plan = { field: { key: BuffPlan.FIELD }, options: [{ value: BuffPlan.APPROVE }] }

test("the plan's own form is its approval", () => {
  expect(isPlanApproval([plan])).toBe(true)
})

test("any other question is not", () => {
  expect(isPlanApproval([])).toBe(false)
  expect(isPlanApproval([plan, plan])).toBe(false)
  expect(isPlanApproval([{ field: { key: BuffPlan.FIELD }, options: [{ value: "yes" }, { value: "no" }] }])).toBe(false)
  expect(isPlanApproval([{ field: { key: "q1" }, options: [{ value: BuffPlan.APPROVE }] }])).toBe(false)
})
