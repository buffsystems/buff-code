export * as WorkflowReply from "./reply.js"

import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import type { WorkflowExecute } from "./execute.js"
import type { WorkflowLibrary } from "./library.js"
import type { WorkflowProgram } from "./program.js"
import facade from "./facade.txt" with { type: "text" }
import guideText from "./prompts/guide.md" with { type: "text" }
import diagnosticsText from "./prompts/tool-diagnostics.md" with { type: "text" }
import startedText from "./prompts/tool-started.md" with { type: "text" }
import { WorkflowActors } from "./actors.js"

/**
 * Ответы инструментов сценариев модели (#448): руководство, диагностика по строкам файла, запуск, список
 * прогонов, один прогон целиком, сохранённые, пробный кусочек. Всё полностью — без обрезки.
 */

const json = (value: unknown) => JSON.stringify(value)
const pretty = (value: unknown) => "```json\n" + JSON.stringify(value, null, 2) + "\n```"

/** Руководство целиком — с фасадом, по которому проверяется скрипт. */
export function guide(): string {
  return WorkflowActors.render(guideText, { facade: facade.trim() })
}

export function diagnostics(file: string, list: readonly WorkflowProgram.Diagnostic[]): string {
  return WorkflowActors.render(diagnosticsText, {
    diagnostics: list.map((item) => `${file}:L${item.line}:C${item.column} ${item.message}`).join("\n"),
  })
}

export function started(input: {
  readonly run: string
  readonly path: string
  readonly phases: readonly string[]
}): string {
  return WorkflowActors.render(startedText, {
    run: input.run,
    path: input.path,
    phases: input.phases.length ? input.phases.join(" → ") : "none declared",
  })
}

const headline = (run: BuffWorkflow.Run) =>
  `${run.id} · ${run.label} · ${BuffWorkflow.runLabel(run)} · ${BuffWorkflow.tokens(run.metrics.tokens.total)} tokens`

export function runs(list: readonly BuffWorkflow.Run[]): string {
  if (!list.length) return "No workflow runs yet."
  return list.map((run) => `${headline(run)} · updated ${new Date(run.updated).toISOString()}`).join("\n")
}

const stepLine = (step: BuffWorkflow.Step) =>
  `  - ${step.actor}: ${step.status}` +
  (step.error ? ` — ${step.error}` : "") +
  (step.result === undefined ? "" : ` → ${json(step.result)}`)

export function run(detail: BuffWorkflowRpc.Detail): string {
  const { run } = detail
  const phases = BuffWorkflow.phases(run.phases, detail.steps)
  const waiting = detail.questions.filter((item) => item.answer === undefined)
  const section = (title: string, lines: readonly string[]) => (lines.length ? [`${title}:`, ...lines, ""] : [])
  return [
    headline(run),
    ...(run.scriptPath ? [`Script: ${run.scriptPath}`] : []),
    ...(Object.keys(run.args).length ? [`Args: ${json(run.args)}`] : []),
    ...(run.supersededBy ? [`Superseded by ${run.supersededBy}`] : []),
    `Metrics: ${BuffWorkflow.metricsText(run.metrics)}`,
    "",
    ...phases.flatMap((phase, index) => [
      `${phase.name === BuffWorkflow.NO_PHASE ? phase.name : `Phase ${index + 1}. ${phase.name}`} — ${phase.status}`,
      ...phase.steps.map(stepLine),
    ]),
    "",
    ...section(
      "Waiting questions",
      waiting.map((item) => `- question_id "${item.id}" from ${item.actor}: ${item.text}`),
    ),
    ...section(
      "Reported",
      detail.items.map((item) => `- ${item.artifact ? `[${item.artifact}] ` : ""}${json(item.value)}`),
    ),
    ...section(
      "Artifacts",
      detail.artifacts.map(
        (item) => `- ${item.title ?? item.id} (${item.kind}, v${item.version}${item.primary ? ", primary" : ""})`,
      ),
    ),
    ...section(
      "Log",
      detail.log.map((line) => `- ${line.text}`),
    ),
    ...(run.result === undefined ? [] : ["Result:", pretty(run.result)]),
  ]
    .join("\n")
    .trimEnd()
}

export function saved(list: Awaited<ReturnType<WorkflowLibrary.Library["list"]>>): string {
  if (!list.saved.length && !list.invalid.length) return "No saved workflows."
  const workflows = list.saved.map(({ meta }) =>
    [
      `${meta.name} — ${meta.description}`,
      ...(meta.whenToUse ? [`  When: ${meta.whenToUse}`] : []),
      ...Object.entries(meta.args).map(
        ([name, decl]) =>
          `  ${name}: ${decl.type}${decl.required ? ", required" : ""}` +
          (decl.default === undefined ? "" : `, default ${json(decl.default)}`) +
          (decl.description ? ` — ${decl.description}` : ""),
      ),
    ].join("\n"),
  )
  const broken = list.invalid.map((item) => `${item.path}: ${item.problem}`)
  return [...workflows, ...(broken.length ? ["Unreadable:", ...broken] : [])].join("\n")
}

export function evaluated(input: {
  readonly outcome: WorkflowExecute.Outcome
  readonly logs: readonly string[]
}): string {
  const logs = input.logs.length ? ["Logs:", ...input.logs.map((line) => `- ${line}`)] : []
  const outcome = input.outcome
  const head =
    outcome.status === "completed"
      ? `Value: ${json(outcome.result)}`
      : outcome.status === "errored"
        ? `Error: ${outcome.error}`
        : `Stopped: ${outcome.error ?? outcome.reason}`
  return [head, ...logs].join("\n")
}
