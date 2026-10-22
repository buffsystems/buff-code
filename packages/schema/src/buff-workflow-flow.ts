export * as BuffWorkflowFlow from "./buff-workflow-flow.js"

import { BuffI18n } from "./buff-i18n.js"
import { BuffWorkflow } from "./buff-workflow.js"
import { BuffWorkflowFile } from "./buff-workflow-file.js"

/**
 * Слова и форма запуска сценариев (#448) — общие для окна и консоли: состояния шагов и фаз,
 * аргументы словами, поля запуска по типам, строка прогона, текст «исправить в чате». Слова —
 * английские исходные строки: подписи переводит экран, составные строки — переданный переводчик (#472).
 */

/** Коротко — для значка; полностью, с причиной, — `BuffWorkflow.runLabel`. */
export const STATUS_LABEL: Record<BuffWorkflow.RunStatus, string> = {
  pending: "Preparing",
  running: "Running",
  completed: "Completed",
  errored: "Error",
  stopped: "Stopped",
}

export const STEP_LABEL: Record<BuffWorkflow.StepStatus, string> = {
  running: "In progress",
  waiting: "Waiting for an answer",
  approval: "Waiting for permission",
  done: "Done",
  cached: "From the previous run",
  failed: "Failed",
}

export const PHASE_LABEL: Record<BuffWorkflow.PhaseStatus, string> = {
  pending: "Ahead",
  running: "In progress",
  done: "Done",
  failed: "Failed",
}

export const KIND_LABEL: Record<BuffWorkflow.Artifact["kind"], string> = {
  file: "file",
  markdown: "text",
  table: "table",
  metrics: "metrics",
  chart: "chart",
  board: "board",
}

export const TYPE_LABEL: Record<BuffWorkflowFile.ArgType, string> = {
  string: "string",
  number: "number",
  boolean: "yes/no",
  json: "JSON",
}

type Decls = BuffWorkflowFile.Meta["args"]

export function argsSummary(decls: Decls, t: BuffI18n.T = BuffI18n.english): string {
  const entries = Object.entries(decls)
  if (!entries.length) return t("No arguments")
  const one = ([name, decl]: [string, BuffWorkflowFile.ArgDecl]) =>
    [
      `${name} — ${t(TYPE_LABEL[decl.type])}`,
      ...(decl.required ? [t("required")] : []),
      ...(decl.default === undefined ? [] : [t("default {value}", { value: JSON.stringify(decl.default) })]),
    ].join(", ")
  return t("Arguments: {list}", { list: entries.map(one).join("; ") })
}

const asText = (value: unknown) =>
  value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)

export function formTexts(decls: Decls): Record<string, string> {
  return Object.fromEntries(Object.entries(decls).map(([name, decl]) => [name, asText(decl.default)]))
}

/** Тексты полей → значения по типам; не заданное — по умолчанию; ошибки — по полям. */
export function formValues(decls: Decls, texts: Readonly<Record<string, string>>): BuffWorkflowFile.Checked {
  const problems: Record<string, string> = {}
  const given: Record<string, unknown> = {}
  for (const [name, decl] of Object.entries(decls)) {
    const parsed = BuffWorkflowFile.fromText(decl, texts[name] ?? "")
    if (parsed.problem) problems[name] = parsed.problem
    else if (parsed.value !== undefined) given[name] = parsed.value
  }
  const checked = BuffWorkflowFile.checkArgs(decls, given)
  if ("problems" in checked) return { problems: { ...checked.problems, ...problems } }
  return Object.keys(problems).length ? { problems } : checked
}

export function fixSaved(name: string, path: string, t: BuffI18n.T = BuffI18n.english): string {
  return t("Fix the saved workflow «{name}» (file {path}) and save it again: ", { name, path })
}

export function fixRun(run: Pick<BuffWorkflow.Run, "id" | "label">, t: BuffI18n.T = BuffI18n.english): string {
  return t("Fix the workflow run «{label}» ({id}) with workflow_amend: ", { label: run.label, id: run.id })
}

export function runLine(
  run: Pick<
    BuffWorkflow.Run,
    "status" | "stopReason" | "error" | "created" | "updated" | "finished" | "started" | "spent" | "metrics"
  >,
  now: number,
  t: BuffI18n.T = BuffI18n.english,
): string {
  return [
    BuffWorkflow.runLabel(run, t),
    BuffWorkflow.elapsed(run, now, t),
    BuffWorkflow.metricsText(run.metrics, t),
  ].join(" · ")
}

/** «Фаза 2 из 3: Проверка» — где прогон сейчас или где встал; у выполненного и без фаз — ничего. */
export function progress(
  phases: readonly { readonly name: string; readonly status: BuffWorkflow.PhaseStatus }[],
  status: BuffWorkflow.RunStatus,
  t: BuffI18n.T = BuffI18n.english,
): string {
  if (!phases.length || status === "completed") return ""
  const index = phases.findIndex((phase) => phase.status === "running" || phase.status === "failed")
  const at =
    index >= 0
      ? index
      : Math.max(
          0,
          phases.findLastIndex((phase) => phase.status === "done"),
        )
  const name = phases[at]!.name
  return t("Phase {index} of {count}: {name}", {
    index: at + 1,
    count: phases.length,
    name: name === BuffWorkflow.NO_PHASE ? t(name) : name,
  })
}
