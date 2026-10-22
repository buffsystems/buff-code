export * as WorkflowView from "./workflow-view"

import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import { BuffWorkflowPanels } from "@opencode/schema/buff-workflow-panels"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { t } from "./locale"

/**
 * Сценарии в консоли (#448) без отрисовки: строки выбора списка и хода прогона, тексты шага и
 * панелей. Слова и вычисления панелей — общие с окном (схема), здесь — только раскладка в строки.
 */

type Option = {
  readonly title: string
  readonly value: string
  readonly description?: string
  readonly footer?: string
  readonly category?: string
  readonly disabled?: boolean
}
type Items = BuffWorkflowRpc.Detail["items"]

export function listOptions(
  list: {
    readonly saved: readonly BuffWorkflowRpc.Saved[]
    readonly invalid: readonly { path: string; problem: string }[]
  },
  runs: readonly BuffWorkflow.Run[],
  now: number,
): Option[] {
  const saved = list.saved.map((item) => ({
    category: t("Saved"),
    title: BuffWorkflowFile.displayName(item.meta),
    value: `saved:${item.meta.name}`,
    description: `${item.meta.description} · ${BuffWorkflowFlow.argsSummary(item.meta.args, t)}`,
    ...(item.last
      ? { footer: t("last: {status}", { status: t(BuffWorkflowFlow.STATUS_LABEL[item.last.status]) }) }
      : {}),
  }))
  const invalid = list.invalid.map((item) => ({
    category: t("Saved"),
    title: item.path,
    value: `invalid:${item.path}`,
    description: t("Unreadable: {problem}", { problem: t(item.problem) }),
    disabled: true,
  }))
  const history = runs.map((run) => ({
    category: t("Runs"),
    title: run.label,
    value: `run:${run.id}`,
    description: BuffWorkflowFlow.runLine(run, now, t),
    footer: run.workflow ? `«${run.workflow}»` : t("from the chat"),
  }))
  const all = [...saved, ...invalid, ...history]
  if (all.length) return all
  return [
    {
      title: t("No workflows yet"),
      value: "empty",
      description: t("Ask the agent in the chat: “make a workflow that…”, and once it works — “save it”."),
      disabled: true,
    },
  ]
}

const phaseTitle = (phase: ReturnType<typeof BuffWorkflow.phases>[number], index: number) =>
  `${phase.name === BuffWorkflow.NO_PHASE ? t(phase.name) : `${index + 1}. ${phase.name}`} — ${t(BuffWorkflowFlow.PHASE_LABEL[phase.status])}`

export function runOptions(detail: BuffWorkflowRpc.Detail, now: number): Option[] {
  const run = detail.run
  const action = (value: string, title: string, description?: string): Option => ({
    category: t("Actions"),
    value,
    title,
    ...(description ? { description } : {}),
  })
  const actions = [
    action("refresh", t("Refresh"), BuffWorkflowFlow.runLine(run, now, t)),
    ...(run.status === "running" ? [action("stop", t("Stop"))] : []),
    ...(BuffWorkflow.resumable(run)
      ? [action("resume", t("Resume"), t("from the same place: finished steps are not repeated"))]
      : []),
    ...(run.session ? [action("session", t("Open session"), t("the run result arrives there"))] : []),
    ...(run.supersededBy
      ? []
      : [action("fix", t("Fix in chat"), t("write what to change — the agent will amend the run"))]),
  ]
  const questions = detail.questions
    .filter((question) => question.answer === undefined)
    .map((question) => ({
      category: t("Subagent questions"),
      value: `question:${question.id}`,
      title: `${question.actor}: ${question.text}`,
      description: t("Enter — answer"),
    }))
  const approvals = run.session
    ? detail.steps
        .filter((step) => step.status === "approval")
        .map((step) => ({
          category: t("Steps waiting for permission"),
          value: "session",
          title: t("{actor} is waiting for your permission", { actor: step.actor }),
          description: t("Enter — open the workflow session and answer"),
        }))
    : []
  const phases = BuffWorkflow.phases(run.phases, detail.steps).flatMap((phase, index) =>
    phase.steps.map((step) => ({
      category: phaseTitle(phase, index),
      value: `step:${step.id}`,
      title: `${step.actor} — ${t(BuffWorkflowFlow.STEP_LABEL[step.status])}`,
      description: `${BuffWorkflow.stepElapsed(step, now, t)} · ${BuffWorkflow.metricsText(step.metrics, t)}`,
    })),
  )
  const artifacts = detail.artifacts.map((artifact) => ({
    category: t("Artifacts"),
    value: `artifact:${artifact.id}`,
    title: artifact.title ?? artifact.id,
    description: artifact.primary
      ? t("main result · {kind}", { kind: t(BuffWorkflowFlow.KIND_LABEL[artifact.kind]) })
      : t(BuffWorkflowFlow.KIND_LABEL[artifact.kind]),
  }))
  const result =
    run.result === undefined
      ? []
      : [{ category: t("Result"), value: "result", title: t("Run result"), description: t("Enter — show") }]
  const log = detail.log.length
    ? [
        {
          category: t("Log"),
          value: "log",
          title: t("Log · {count}", { count: detail.log.length }),
          description: t("Enter — show"),
        },
      ]
    : []
  return [...actions, ...approvals, ...questions, ...phases, ...artifacts, ...result, ...log]
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

export function stepText(step: BuffWorkflow.Step, now: number): string {
  return [
    `${t(BuffWorkflowFlow.STEP_LABEL[step.status])} · ${BuffWorkflow.stepElapsed(step, now, t)} · ${BuffWorkflow.metricsText(step.metrics, t)}`,
    `${t("Assigned:")}\n${step.instructions}`,
    ...(step.error ? [t("Failure: {error}", { error: t(step.error) })] : []),
    ...(step.result === undefined ? [] : [`${t("Step result:")}\n${pretty(step.result)}`]),
  ].join("\n\n")
}

function columns(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => (row[index] ?? "").length)))
  const line = (row: readonly string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd()
  return [line(header), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map(line)].join("\n")
}

export function artifactText(artifact: BuffWorkflow.Artifact, items: Items): string {
  const own = items.filter((item) => item.artifact === artifact.id)
  const spec = artifact.spec as never
  switch (artifact.kind) {
    case "markdown":
      return artifact.content ?? ""
    case "file":
      return t("File: {path}", { path: artifact.path ?? "—" })
    case "table": {
      const table = BuffWorkflowPanels.table(spec, own, t)
      return table.rows.length ? columns(table.columns, table.rows) : t("No rows yet.")
    }
    case "metrics":
      return BuffWorkflowPanels.metrics(spec, own, t)
        .map((tile) => `${tile.label}: ${tile.value}`)
        .join("\n")
    case "chart":
      return BuffWorkflowPanels.chart(spec, own, t)
        .series.map((series) => `${series.label}: ${series.points.map((point) => `${point.x}=${point.y}`).join(", ")}`)
        .join("\n")
    case "board":
      return BuffWorkflowPanels.board(spec, own, t)
        .map((column) =>
          [
            `${column.name} (${column.cards.length}):`,
            ...column.cards.map((card) =>
              [`  • ${card.title}`, ...card.detail.map((line) => `    ${line}`)].join("\n"),
            ),
          ].join("\n"),
        )
        .join("\n")
  }
}
