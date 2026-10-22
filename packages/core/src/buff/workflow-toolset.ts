export * as BuffWorkflowToolset from "./workflow-toolset.js"

import { Effect, Schema } from "effect"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import type { Permission } from "../permission.js"
import { BuffLocale } from "./locale.js"
import type { BuffWorkflowService } from "./workflow-service.js"
import { BuffWorkflowTools } from "./workflow-tools.js"
import { WorkflowCompile } from "./workflow/compile.js"
import { WorkflowPolicy } from "./workflow/policy.js"
import { WorkflowReply } from "./workflow/reply.js"
import { WorkflowSource } from "./workflow/source.js"

/**
 * Инструменты сценариев для модели (#448): договор — `workflow-tools.ts`, здесь — исполнение.
 * Скрипт берётся из источника, компилируется, запуск подтверждает человек; дальше — служба.
 */

const Reply = Schema.Struct({})
const fail = (message: string) => Effect.fail(new ToolFailure({ message }))
const call = <A>(body: () => Promise<A>) => Effect.promise(body)
const NO_GUIDE = "Call workflow_guide first: scripts are accepted only after the guide has been read in this session."

export const register = Effect.fn(function* (
  ctx: Context,
  service: BuffWorkflowService.Interface,
  permission: Permission.Interface,
) {
  const directory = ctx.location.directory
  const guided = (session: string) => (service.guided.has(session) ? Effect.void : fail(NO_GUIDE))
  const compiled = (source: { readonly text: string; readonly path: string }, options = {}) => {
    const result = WorkflowCompile.compile(source.text, options)
    return "js" in result ? Effect.succeed(result) : fail(WorkflowReply.diagnostics(source.path, result.diagnostics))
  }
  const resolved = (input: WorkflowSource.Input) =>
    call(() => WorkflowSource.resolve(input, service.source(directory))).pipe(
      Effect.flatMap((source) => ("problem" in source ? fail(source.problem) : Effect.succeed(source))),
    )
  const confirm = (context: Tool.Context, resources: readonly string[], metadata: Record<string, unknown>) =>
    permission.assert({
      action: BuffWorkflow.PERMISSION_ACTION,
      resources: [...resources],
      metadata,
      sessionID: context.sessionID,
      agent: context.agent,
      source: { type: "tool", messageID: context.messageID, id: context.id },
    })
  const launch = (context: Tool.Context, run: Parameters<typeof BuffWorkflow.confirmation>[0], kind: string) =>
    confirm(context, BuffWorkflow.confirmation(run, BuffLocale.t), { kind, ...run })
  const toolError = (error: unknown) =>
    error instanceof ToolFailure ? error : new ToolFailure({ message: "Workflow tool failed", error })
  const add = <Input extends Schema.Codec<unknown, unknown, never, never>>(
    definition: { readonly name: string; readonly description: string; readonly input: Input },
    permission: string,
    execute: (input: Input["Type"], context: Tool.Context) => Effect.Effect<string, unknown>,
  ) =>
    ctx.tool
      .transform((editor) =>
        editor.add({
          ...definition,
          options: { codemode: false, permission },
          output: Reply,
          execute: (input, context) =>
            execute(input as Input["Type"], context).pipe(
              Effect.map((content) => ({ output: {}, content })),
              Effect.mapError(toolError),
            ),
        }),
      )
      .pipe(Effect.orDie)
  const tools = BuffWorkflowTools.tools
  const orchestrate = WorkflowPolicy.ORCHESTRATE

  yield* add(tools.guide, orchestrate, (_, context) =>
    Effect.sync(() => {
      service.guided.add(context.sessionID)
      return WorkflowReply.guide()
    }),
  )

  yield* add(tools.create, orchestrate, (input, context) =>
    Effect.gen(function* () {
      if (!input.saved) yield* guided(context.sessionID)
      const source = yield* resolved(input)
      const program = yield* compiled(source)
      const args = source.args ?? {}
      yield* launch(
        context,
        {
          label: input.name,
          phases: program.phases,
          commands: program.commands,
          args,
          directory,
          actors: program.actors.length,
        },
        "run",
      )
      const started = yield* call(() =>
        service.engine.start({
          compiled: program,
          script: source.text,
          scriptPath: source.path,
          args,
          label: input.name,
          directory,
          root: context.sessionID,
          ...(source.workflow ? { workflow: source.workflow } : {}),
        }),
      )
      return WorkflowReply.started({ run: started.run, path: source.path, phases: program.phases })
    }),
  )

  yield* add(tools.amend, orchestrate, (input, context) =>
    Effect.gen(function* () {
      yield* guided(context.sessionID)
      const previous = yield* service.runs.getRun(input.run_id)
      if (!previous) return yield* fail(`No workflow run ${input.run_id}; see workflow_runs.`)
      const source = yield* resolved({
        ...(input.script !== undefined ? { script: input.script } : {}),
        ...(input.path !== undefined ? { path: input.path } : {}),
      })
      if ((yield* call(() => service.script(input.run_id))) === source.text)
        return yield* fail(
          `script_unchanged: ${source.path} still equals what ${input.run_id} ran — your edit did not land.`,
        )
      const program = yield* compiled(source)
      const label = input.name ?? previous.label
      yield* launch(
        context,
        {
          label,
          phases: program.phases,
          commands: program.commands,
          args: previous.args,
          directory: previous.directory,
          actors: program.actors.length,
        },
        "amend",
      )
      const amended = yield* call(() =>
        service.engine.amend(input.run_id, { compiled: program, script: source.text, label, scriptPath: source.path }),
      )
      if (!amended.run) return yield* fail(amended.problem ?? "The run could not be amended.")
      return `Supersedes ${input.run_id}.\n${WorkflowReply.started({ run: amended.run, path: source.path, phases: program.phases })}`
    }),
  )

  yield* add(tools.save, orchestrate, (input, context) =>
    Effect.gen(function* () {
      yield* guided(context.sessionID)
      const bad = BuffWorkflowFile.nameProblem(input.name)
      if (bad) return yield* fail(bad)
      const source =
        input.script !== undefined
          ? { text: input.script, path: input.name + BuffWorkflowFile.EXTENSION }
          : yield* resolved(input.script_path !== undefined ? { path: input.script_path } : {})
      const program = yield* compiled(source)
      const exists = (yield* call(() => service.library.read(input.name))) !== undefined
      if (exists && !input.overwrite)
        return yield* fail(
          `A saved workflow "${input.name}" exists. Ask the user, then call again with overwrite: true.`,
        )
      const meta: BuffWorkflowFile.Meta = {
        name: input.name,
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        description: input.description,
        ...(input.whenToUse ? { whenToUse: input.whenToUse } : {}),
        args: input.args ?? {},
      }
      yield* confirm(
        context,
        BuffWorkflow.saveConfirmation(
          {
            name: BuffWorkflowFile.displayName(meta),
            description: meta.description,
            created: !exists,
            phases: program.phases,
          },
          BuffLocale.t,
        ),
        { kind: "save", name: meta.name },
      )
      const saved = yield* call(() => service.library.save(meta, source.text, { overwrite: true }))
      if ("diagnostics" in saved && saved.diagnostics)
        return yield* fail(WorkflowReply.diagnostics(source.path, saved.diagnostics))
      if ("problem" in saved && saved.problem) return yield* fail(saved.problem)
      return `Saved "${meta.name}" to ${"path" in saved ? saved.path : meta.name}. Run it later with workflow_create and saved: { name: "${meta.name}" }.`
    }),
  )

  yield* add(tools.eval, orchestrate, (input, context) =>
    Effect.gen(function* () {
      yield* guided(context.sessionID)
      const source =
        input.code !== undefined
          ? { text: input.code, path: "snippet" }
          : yield* resolved(input.path !== undefined ? { path: input.path } : {})
      const program = yield* compiled(source, { snippet: true })
      if (program.commands.length)
        yield* launch(
          context,
          {
            label: BuffLocale.t("Trial snippet"),
            phases: [],
            commands: program.commands,
            args: {},
            directory,
            actors: 0,
          },
          "eval",
        )
      const result = yield* call(() => service.eval(source.text, directory))
      return "diagnostics" in result && result.diagnostics
        ? WorkflowReply.diagnostics(source.path, result.diagnostics)
        : WorkflowReply.evaluated(result)
    }),
  )

  yield* add(tools.saved, orchestrate, () => call(() => service.library.list()).pipe(Effect.map(WorkflowReply.saved)))
  yield* add(tools.runs, orchestrate, () => service.runs.runs().pipe(Effect.map(WorkflowReply.runs)))
  yield* add(tools.run, orchestrate, (input) =>
    service.runs
      .detail(input.run_id)
      .pipe(
        Effect.flatMap((detail) =>
          detail
            ? Effect.succeed(WorkflowReply.run(detail))
            : fail(`No workflow run ${input.run_id}; see workflow_runs.`),
        ),
      ),
  )
  yield* add(tools.resume, orchestrate, (input) =>
    call(() => service.engine.resume(input.run_id)).pipe(
      Effect.flatMap((done) =>
        done.problem
          ? fail(done.problem)
          : Effect.succeed(`Run ${input.run_id} resumed; you will get a notification when it settles.`),
      ),
    ),
  )
  yield* add(tools.answer, orchestrate, (input) =>
    call(() => service.engine.answer(input.question_id, input.answer)).pipe(
      Effect.flatMap((done) => (done.problem ? fail(done.problem) : Effect.succeed("Answer delivered."))),
    ),
  )

  yield* add(tools.result, WorkflowPolicy.ACTOR, (input, context) =>
    Effect.sync(() => service.results.submit(context.sessionID, input.result)).pipe(
      Effect.flatMap((done) =>
        done.problems
          ? fail(`The result does not match the schema:\n${done.problems.join("\n")}`)
          : Effect.succeed("Result accepted."),
      ),
    ),
  )
  yield* add(tools.question, WorkflowPolicy.ACTOR, (input, context) =>
    Effect.tryPromise({
      try: () => service.engine.question(context.sessionID, input.question),
      catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }),
    }),
  )
})
