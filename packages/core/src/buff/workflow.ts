export * as BuffWorkflowPlugin from "./workflow.js"

import { Effect } from "effect"
import type { Scope } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { Permission } from "../permission.js"
import { BuffLocale } from "./locale.js"
import { BuffWorkflowService } from "./workflow-service.js"
import { BuffWorkflowToolset } from "./workflow-toolset.js"

/**
 * Сценарии в каталоге (#448): окно и консоль говорят со службой сценариев через RPC, модель —
 * инструментами (договор — `workflow-tools.ts`). Запуск и сохранение человек подтверждает
 * запросом разрешения; хранит и исполняет служба процесса (`workflow-service.ts`).
 */

const call = <A>(body: () => Promise<A>) => Effect.promise(body)

export const Plugin = define<BuffWorkflowService.Service | Permission.Service | Scope.Scope>({
  id: "buff.workflow",
  effect: Effect.fn(function* (ctx) {
    const service = yield* BuffWorkflowService.Service
    const permission = yield* Permission.Service
    const missing = (what: string) => Effect.die(new Error(what))

    yield* ctx.rpc
      .register(BuffWorkflowRpc.Rpc, {
        list: () => call(() => service.list()),
        read: ({ name }) =>
          call(() => service.library.read(name)).pipe(
            Effect.flatMap((saved) =>
              saved && "meta" in saved
                ? Effect.succeed(saved)
                : missing(BuffLocale.t("There is no workflow «{name}».", { name })),
            ),
          ),
        saveMeta: ({ name, meta }) => call(() => service.library.saveMeta(name, meta)),
        remove: ({ name }) => call(() => service.library.remove(name)).pipe(Effect.map((removed) => ({ removed }))),
        start: (input) =>
          call(() => service.startSaved(input)).pipe(
            Effect.map((started) =>
              "diagnostics" in started && started.diagnostics
                ? {
                    problem: started.diagnostics
                      .map((item) => `L${item.line}:C${item.column} ${item.message}`)
                      .join("\n"),
                  }
                : started,
            ),
          ),
        runs: ({ workflow }) => service.runs.runs(workflow).pipe(Effect.map((runs) => ({ runs: [...runs] }))),
        run: ({ id }) =>
          service.runs
            .detail(id)
            .pipe(
              Effect.flatMap((detail) =>
                detail ? Effect.succeed(detail) : missing(BuffLocale.t("The run no longer exists.")),
              ),
            ),
        stop: ({ id }) => call(() => service.engine.stop(id)).pipe(Effect.map((stopped) => ({ stopped }))),
        resume: ({ id }) => call(() => service.engine.resume(id)),
        answer: ({ question, text }) => call(() => service.engine.answer(question, text)),
      })
      .pipe(Effect.orDie)

    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        event.effect = service.policy.effect(event)
      }),
    )

    yield* BuffWorkflowToolset.register(ctx, service, permission)
  }),
})
