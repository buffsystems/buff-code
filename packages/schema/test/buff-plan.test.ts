// План (#463): форма утверждения и решение человека.
import { describe, expect, test } from "bun:test"
import { BuffPlan } from "../src/buff-plan.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

describe("the approval form", () => {
  test("one question: approve, or write what to change", () => {
    const [field] = BuffPlan.fields(ru)
    expect(field).toMatchObject({ key: BuffPlan.FIELD, type: "string", custom: true })
    expect(field!.options).toEqual([
      {
        value: BuffPlan.APPROVE,
        label: "Утвердить и начать",
        description: "Режим плана выключится, агент приступит к работе",
      },
    ])
  })
})

describe("the decision", () => {
  test("approved, or a remark to revise with", () => {
    expect(BuffPlan.decision({ [BuffPlan.FIELD]: BuffPlan.APPROVE })).toEqual({ approved: true })
    expect(BuffPlan.decision({ [BuffPlan.FIELD]: "Добавь тесты" })).toEqual({ approved: false, note: "Добавь тесты" })
  })
  test("no answer is a revise without a remark", () => {
    expect(BuffPlan.decision({})).toEqual({ approved: false, note: "" })
  })
})

describe("a decision in the call's metadata", () => {
  test("read back, or nothing", () => {
    expect(BuffPlan.decisionOf({ decision: { approved: true } })).toEqual({ approved: true })
    expect(BuffPlan.decisionOf({ decision: { approved: false, note: "x" } })).toEqual({ approved: false, note: "x" })
    expect(BuffPlan.decisionOf({})).toBeUndefined()
    expect(BuffPlan.decisionOf({ decision: "yes" })).toBeUndefined()
  })
})

describe("the card", () => {
  test("its state words from the call's metadata", () => {
    expect(BuffPlan.state(undefined, "running", ru)).toBe("Ждёт утверждения")
    expect(BuffPlan.state({ approved: true }, "completed", ru)).toBe("Утверждён")
    expect(BuffPlan.state({ approved: false, note: "x" }, "completed", ru)).toBe("На доработке: x")
    expect(BuffPlan.state(undefined, "error", ru)).toBe("Не утверждён")
    expect(BuffPlan.state(undefined, "running")).toBe("Waiting for approval")
  })
})
