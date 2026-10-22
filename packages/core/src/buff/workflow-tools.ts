export * as BuffWorkflowTools from "./workflow-tools.js"

import { Schema } from "effect"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"

/**
 * Инструменты сценариев для модели (#448), как в ZCode: описание — договор инструмента (что,
 * когда, как вызывать). Подробные правила написания — в руководстве `workflow/prompts/guide.md`,
 * его выдаёт `workflow_guide`.
 */

const Args = Schema.Record(Schema.String, Schema.Unknown).annotate({
  description: "Values for the workflow's declared arguments.",
})
const RunId = Schema.String.annotate({ description: "Run ID from a result, a notification or workflow_runs." })

export const tools = {
  guide: {
    name: "workflow_guide",
    description: `Load the guide for writing workflows: when to use one, subagent topology, typed results, phases, verification, the facade the script is checked against. Call it before writing or revising a workflow script; workflow_create, workflow_amend, workflow_save and workflow_eval refuse a script until it has been read in this session. Running a saved workflow by name does not need it.`,
    input: Schema.Struct({}),
  },
  create: {
    name: "workflow_create",
    description: `Create and run a workflow: a TypeScript script that orchestrates subagents with plain control flow and typed results. The script is typechecked, the user confirms its phases and commands, and it runs in the background; you get a notification with its result when it settles — do not poll.

When to use: only when the user explicitly asks for a workflow (сценарий / workflow) or to run a saved one. Otherwise delegate to a subagent or do the work yourself.

Pass exactly one source: \`script\` (inline; saved to a draft file the result names — revise that file and amend with \`path\`, never paste the script again), \`saved\` (a saved workflow by name with its args; check workflow_saved first), or \`path\` (a script file on disk). To change an existing run, call workflow_amend instead.`,
    input: Schema.Struct({
      name: Schema.String.annotate({ description: "Short run label in the user's language." }),
      script: Schema.optional(Schema.String.annotate({ description: "The whole script, inline." })),
      saved: Schema.optional(Schema.Struct({ name: Schema.String, args: Schema.optional(Args) })),
      path: Schema.optional(
        Schema.String.annotate({ description: "A script file on disk, usually a draft a result named." }),
      ),
    }),
  },
  amend: {
    name: "workflow_amend",
    description: `Amend an existing run with a revised script: starts a NEW run that supersedes the old one (stopping it if it is still running) and reuses the finished work of its named subagents, so only what changed is paid for again. Use it when a run errored, stopped, or completed but needs one more stage — never rewrite the workflow from scratch with workflow_create. Pass \`path\` (the draft file, edited in place) or \`script\`. Read workflow_guide first.`,
    input: Schema.Struct({
      run_id: RunId,
      path: Schema.optional(Schema.String),
      script: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String.annotate({ description: "New label; defaults to the previous run's." })),
    }),
  },
  save: {
    name: "workflow_save",
    description: `Save a workflow so it can be run again later by name (workflow_create's \`saved\` source). Saved workflows live with the user, not in the repository. NEVER call it unsolicited: when a workflow you built looks reusable, suggest saving it in one sentence and wait; call it only after the user agrees or asks. The user confirms the save. Declare as \`args\` exactly the values that change between runs. Pass \`script\` (the body) or \`script_path\` (a draft file). Read workflow_guide first.`,
    input: Schema.Struct({
      name: Schema.String.annotate({ description: "File-safe identifier: letters, digits, dot, dash and underscore." }),
      title: Schema.optional(
        Schema.String.annotate({
          description: "The name the user sees, in the user's language, a few words; `name` stays the file identifier.",
        }),
      ),
      description: Schema.String.annotate({
        description: "One line: what the workflow does, for a reader who has not seen this conversation.",
      }),
      whenToUse: Schema.optional(Schema.String.annotate({ description: "When this workflow is the right answer." })),
      args: Schema.optional(Schema.Record(Schema.String, BuffWorkflowFile.ArgDecl)),
      script: Schema.optional(Schema.String),
      script_path: Schema.optional(Schema.String),
      overwrite: Schema.optional(
        Schema.Boolean.annotate({ description: "Replace an existing workflow with this name." }),
      ),
    }),
  },
  eval: {
    name: "workflow_eval",
    description: `Compile and run a small snippet synchronously against the same compiler, sandbox and read-only world a real run uses — no agents, no report, nothing persists. The test bench for authoring: check a parser against real command output, see what a glob returns, exercise a gate on real repository state before putting it in a script. Pass \`code\` or \`path\`. Read workflow_guide first.`,
    input: Schema.Struct({ code: Schema.optional(Schema.String), path: Schema.optional(Schema.String) }),
  },
  saved: {
    name: "workflow_saved",
    description: `List the saved workflows: name, what each does, when to use it, its arguments; and saved files that could not be read, named so they can be fixed. Check here before writing a workflow from scratch.`,
    input: Schema.Struct({}),
  },
  runs: {
    name: "workflow_runs",
    description: `List workflow runs, most recently updated first: id, label, status, tokens, timestamps. Use it when the user asks how workflows are going or to find a run's id. Runs started here settle on their own with a notification — do not poll.`,
    input: Schema.Struct({}),
  },
  run: {
    name: "workflow_run",
    description: `Show one run: status, phases with their steps, results, reported items, artifacts, pending questions, metrics, the log. An instant snapshot that never waits. Use it when the user asks about a run or a notification was cut short.`,
    input: Schema.Struct({ run_id: RunId }),
  },
  resume: {
    name: "workflow_resume",
    description: `Resume a stopped run under the same id: finished steps are replayed from the journal without spending tokens, unfinished ones run again. Not for errored runs (fix the script with workflow_amend) or superseded ones. A run the user stopped is resumed only when the user asks; one stopped by a provider error — after the cause is fixed; an interrupted one (the service exited) is usually what the user wants continued.`,
    input: Schema.Struct({ run_id: RunId }),
  },
  answer: {
    name: "workflow_answer",
    description: `Answer a question a subagent escalated from inside a running workflow (the notification names its question_id). Your answer becomes that subagent's tool result verbatim; only it was waiting. If you are not sure, look at the run with workflow_run or ask the user first.`,
    input: Schema.Struct({ question_id: Schema.String, answer: Schema.String }),
  },
  result: {
    name: "workflow_result",
    description: `Inside a workflow subagent session only: submit your result for the current task when the task asks for a typed result. The value must match the schema given in the task; mismatches come back so you can fix them and call again.`,
    input: Schema.Struct({
      result: Schema.Unknown.annotate({ description: "The result value matching the task's schema." }),
    }),
  },
  question: {
    name: "workflow_question",
    description: `Inside a workflow subagent session only: when you cannot continue without a decision only a human can make, ask one clear question. You wait for the answer; the rest of the run keeps going.`,
    input: Schema.Struct({ question: Schema.String }),
  },
} as const
