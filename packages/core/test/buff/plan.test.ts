// План (#463): что модель получает после решения человека.
import { expect, test } from "bun:test"
import { BuffPlanPlugin } from "../../src/buff/plan"

test("approved — implement now; a remark — revise and present again", () => {
  expect(BuffPlanPlugin.reply({ approved: true })).toContain("implement the plan now")
  const revise = BuffPlanPlugin.reply({ approved: false, note: "Добавь тесты" })
  expect(revise).toContain("Добавь тесты")
  expect(revise).toContain("call `plan_exit` again")
  expect(BuffPlanPlugin.reply({ approved: false, note: "" })).toContain("Ask what they want changed")
})
