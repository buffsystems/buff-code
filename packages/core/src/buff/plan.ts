export * as BuffPlanPlugin from "./plan.js"

import { Effect, Schema } from "effect"
import type { Scope } from "effect"
import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { BuffPlan } from "@opencode/schema/buff-plan"
import { Form } from "../form.js"
import { QuestionTool } from "../tool/plugin/question.js"
import { Session } from "../session.js"
import { SessionSchema } from "../session/schema.js"
import approvedText from "./plan/prompts/approved.md" with { type: "text" }
import reviseText from "./plan/prompts/revise.md" with { type: "text" }
import reviseEmptyText from "./plan/prompts/revise-empty.md" with { type: "text" }
import { BuffLocale } from "./locale.js"

/**
 * Утверждение плана (#463), как в ZCode: в режиме «План» агент отдаёт готовый план инструментом
 * `plan_exit` — человек видит карточку плана и отвечает «Утвердить и начать» или замечанием.
 * Утверждено — сессия переходит на агента разработки, и модель сразу приступает.
 */

const PLAN = Agent.ID.make("plan")
const BUILD = Agent.ID.make("build")

export const description = `Present your finished plan to the user for approval and leave Plan mode when they approve. The user sees the plan as a card and answers: approve, or a remark on what to change.

Call it in Plan mode the moment your plan is complete and unambiguous — instead of asking "is this plan OK?" or "should I proceed?" in text. If requirements are still unclear, ask with the question tool first. Not for research or questions that need no implementation.

Pass the whole plan as markdown: goal, the steps in order, the files you will touch, how you will verify. On approval you continue at once with implementation; on a remark you revise the plan and call it again.`

export const Input = Schema.Struct({
  plan: Schema.String.annotate({ description: "The complete plan, markdown, in the user's language." }),
})

const Output = Schema.Struct({ approved: Schema.Boolean })

export function reply(decided: BuffPlan.Decision): string {
  if (decided.approved) return approvedText.trim()
  return decided.note ? reviseText.trim().replace("{{note}}", decided.note) : reviseEmptyText.trim()
}

export const Plugin = define<Form.Service | Session.Service | Scope.Scope>({
  id: "buff.plan",
  effect: Effect.fn(function* (ctx) {
    const forms = yield* Form.Service
    const sessions = yield* Session.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: BuffPlan.TOOL,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (_, context) =>
            Effect.gen(function* () {
              if (context.agent !== PLAN)
                return yield* Effect.fail(new ToolFailure({ message: "plan_exit is only for Plan mode." }))
              const state = yield* forms
                .ask({
                  sessionID: context.sessionID,
                  title: BuffLocale.t("Plan"),
                  metadata: {
                    kind: "question",
                    tool: { messageID: context.messageID, id: context.id },
                    buffPlan: true,
                  },
                  fields: BuffPlan.fields(BuffLocale.t),
                })
                .pipe(Effect.orDie)
              // Закрытая форма — или остановленная служба — тот же отказ, что у вопроса: ход
              // прерывается, модели не сообщается «человек отклонил план» (#470).
              if (state.status === "cancelled") return yield* Effect.die(new QuestionTool.CancelledError())
              const decided = BuffPlan.decision(state.answer)
              if (decided.approved)
                yield* sessions
                  .switchAgent({ sessionID: SessionSchema.ID.make(context.sessionID), agent: BUILD })
                  .pipe(Effect.orDie)
              return {
                output: { approved: decided.approved },
                content: reply(decided),
                metadata: { decision: decided },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
})
