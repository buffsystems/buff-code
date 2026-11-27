// Whether a question is the plan's approval (#972, R2-13): the one form «План» mode ends with —
// «approve and start», or a remark of the person's own.

import { BuffPlan } from "@opencode/schema/buff-plan"

type Asked = { field: { key: string }; options: readonly { value: string }[] }

export function isPlanApproval(questions: readonly Asked[]): boolean {
  const only = questions.length === 1 ? questions[0] : undefined
  return (
    only !== undefined &&
    only.field.key === BuffPlan.FIELD &&
    only.options.length === 1 &&
    only.options[0]?.value === BuffPlan.APPROVE
  )
}
