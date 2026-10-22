export * as BuffAutomationPlugin from "./automation.js"

import { Effect, Schema } from "effect"
import type { Scope } from "effect"
import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { Permission } from "../permission.js"
import { Session } from "../session.js"
import { BuffAutomationService } from "./automation-service.js"
import { BuffAutomationTool } from "./automation-tool.js"

/**
 * Автоматизации в каталоге (#447): окно и консоль говорят со службой автоматизаций через RPC
 * плагина, модель — инструментом «создать автоматизацию». Сами автоматизации и часы — в службе
 * процесса (`automation-service.ts`), плагин только передаёт.
 */

const Output = Schema.Struct({ id: Schema.String, next: Schema.Number })

export const Plugin = define<BuffAutomationService.Service | Permission.Service | Session.Service | Scope.Scope>({
  id: "buff.automation",
  effect: Effect.fn(function* (ctx) {
    const automations = yield* BuffAutomationService.Service
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service

    yield* ctx.rpc
      .register(BuffAutomation.Rpc, {
        list: () => automations.list().pipe(Effect.map((list) => ({ automations: [...list] }))),
        save: ({ id, draft }) => automations.save(id, draft),
        remove: ({ id }) => automations.remove(id).pipe(Effect.map((removed) => ({ removed }))),
        pause: ({ id, paused }) => automations.pause(id, paused),
        run: ({ id }) => automations.run(id),
        stop: ({ id }) => automations.stop(id),
        runs: ({ id }) => automations.runs(id).pipe(Effect.map((runs) => ({ runs: [...runs] }))),
        removeRun: ({ id, run }) => automations.removeRun(id, run).pipe(Effect.map((removed) => ({ removed }))),
      })
      .pipe(Effect.orDie)

    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        event.effect = BuffAutomationTool.confirmed(event)
      }),
    )

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: BuffAutomationTool.name,
          options: { codemode: false },
          description: BuffAutomationTool.description,
          input: BuffAutomationTool.Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const session = yield* sessions.get(context.sessionID).pipe(Effect.option)
              const model = session._tag === "Some" ? session.value.model : undefined
              const draft = BuffAutomationTool.draft(
                input,
                ctx.location.directory,
                model
                  ? { id: model.id, providerID: model.providerID, ...(model.variant ? { variant: model.variant } : {}) }
                  : undefined,
              )
              const problem = BuffAutomation.draftProblem(draft)
              if (problem) return yield* Effect.fail(new ToolFailure({ message: problem }))
              yield* permission.assert({
                action: BuffAutomationTool.action,
                resources: BuffAutomationTool.resources(draft),
                metadata: { ...draft },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const saved = yield* automations.save(undefined, draft)
              if (!saved.automation)
                return yield* Effect.fail(
                  new ToolFailure({ message: saved.problem ?? "The automation could not be saved." }),
                )
              return {
                output: { id: saved.automation.id, next: saved.automation.next },
                content: BuffAutomationTool.reply(saved.automation, new Date()),
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: "Unable to create the automation", error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
})
