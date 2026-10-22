// План (#470): форму плана закрыли — или служба остановилась, пока план ждал утверждения. Модель
// не должна получить «человек отклонил план»: это тот же отказ, что у вопроса, — ход
// прерывается, а после перезапуска инструмент помечен «прервано», а не ошибкой со словами модели.
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Agent } from "@opencode/core/agent"
import { Form } from "@opencode/core/form"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { QuestionTool } from "@opencode/core/tool/plugin/question"
import { BuffPlanPlugin } from "@opencode/core/buff/plan"
import { testEffect } from "../lib/effect"
import { toolIdentity, executeTool, registerToolPlugin } from "../lib/tool"

const sessionID = Session.ID.make("ses_plan_cancel_test")
const form = Layer.mock(Form.Service, {
  ask: () => Effect.succeed<Form.TerminalState>({ status: "cancelled" }),
})
// План трогает сессию только при утверждении; здесь до этого не доходит.
const session = Layer.mock(Session.Service, { revert: {} as never })
const planNode = makeLocationNode({
  name: "test/buff-plan-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(BuffPlanPlugin.Plugin)),
  deps: [Tool.node, Form.node, Session.node],
})
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, planNode]), [
    Form.node.replace(form),
    Session.node.replace(session),
  ]),
)

describe("plan_exit", () => {
  it.effect("закрытая форма плана прерывает ход, как вопрос, а не отвечает модели «отклонил»", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const fiber = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        agent: Agent.ID.make("plan"),
        call: { type: "tool-call", id: "call-plan", name: "plan_exit", input: { plan: "# План" } },
      }).pipe(Effect.forkScoped)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(QuestionTool.CancelledError)
    }),
  )
})
