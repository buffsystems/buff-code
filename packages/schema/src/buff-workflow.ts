export * as BuffWorkflow from "./buff-workflow.js"

import { Schema } from "effect"
import { BuffBackground } from "./buff-background.js"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Прогон сценария (#448): записи журнала — актёры (субагенты со своей сессией), шаги (одно
 * задание актёру), фазы, вопросы актёров, опубликованное — и их слова. Метрики полным набором
 * на каждом уровне: шаг, актёр, фаза, прогон. Одинаково для окна, консоли и ядра.
 */

const Count = Schema.Number
export const Metrics = Schema.Struct({
  tokens: Schema.Struct({ input: Count, output: Count, cache: Count, total: Count }),
  files: Schema.Struct({ added: Count, deleted: Count, modified: Count }),
  lines: Schema.Struct({ added: Count, deleted: Count }),
})
export type Metrics = typeof Metrics.Type

export const EMPTY_METRICS: Metrics = {
  tokens: { input: 0, output: 0, cache: 0, total: 0 },
  files: { added: 0, deleted: 0, modified: 0 },
  lines: { added: 0, deleted: 0 },
}

export const RunStatus = Schema.Literals(["pending", "running", "completed", "errored", "stopped"])
export type RunStatus = typeof RunStatus.Type
export const StopReason = Schema.Literals(["user", "model", "provider", "interrupted", "superseded"])
export type StopReason = typeof StopReason.Type
/** waiting — ждёт ответа на свой вопрос; approval — ждёт разрешения человека в сессии. */
export const StepStatus = Schema.Literals(["running", "waiting", "approval", "done", "cached", "failed"])
export type StepStatus = typeof StepStatus.Type

export const Step = Schema.Struct({
  id: Schema.String,
  /** Имя актёра (или его номер, если безымянный). */
  actor: Schema.String,
  phase: Schema.optional(Schema.String),
  instructions: Schema.String,
  status: StepStatus,
  started: Schema.Number,
  finished: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
  metrics: Metrics,
})
export type Step = typeof Step.Type

export const Actor = Schema.Struct({
  key: Schema.String,
  name: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  session: Schema.optional(Schema.String),
})
export type Actor = typeof Actor.Type

export const Question = Schema.Struct({
  id: Schema.String,
  actor: Schema.String,
  step: Schema.String,
  text: Schema.String,
  asked: Schema.Number,
  answer: Schema.optional(Schema.String),
})
export type Question = typeof Question.Type

export const ArtifactKind = Schema.Literals(["file", "markdown", "chart", "table", "metrics", "board"])
export const Artifact = Schema.Struct({
  id: Schema.String,
  kind: ArtifactKind,
  version: Schema.Number,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  primary: Schema.optional(Schema.Boolean),
  /** Файл — путь, markdown — текст; у панелей — описание полей (spec) и их строки из report(). */
  path: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  spec: Schema.optional(Schema.Unknown),
})
export type Artifact = typeof Artifact.Type

export const Run = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  workflow: Schema.optional(Schema.String),
  directory: Schema.String,
  /** Сессия, из которой запущен: ей приходит итог. */
  session: Schema.optional(Schema.String),
  status: RunStatus,
  stopReason: Schema.optional(StopReason),
  error: Schema.optional(Schema.String),
  args: Schema.Record(Schema.String, Schema.Unknown),
  phases: Schema.Array(Schema.String),
  commands: Schema.Array(Schema.String),
  created: Schema.Number,
  updated: Schema.Number,
  finished: Schema.optional(Schema.Number),
  /** Файл скрипта прогона: модель правит его и исправляет прогон по пути. */
  scriptPath: Schema.optional(Schema.String),
  resumedFrom: Schema.optional(Schema.String),
  /** Продолженный прогон: начало текущего отрезка работы и время прежних отрезков, мс. */
  started: Schema.optional(Schema.Number),
  spent: Schema.optional(Schema.Number),
  supersededBy: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Unknown),
  metrics: Metrics,
})
export type Run = typeof Run.Type

export function sum(list: readonly Metrics[]): Metrics {
  return list.reduce<Metrics>(
    (total, item) => ({
      tokens: {
        input: total.tokens.input + item.tokens.input,
        output: total.tokens.output + item.tokens.output,
        cache: total.tokens.cache + item.tokens.cache,
        total: total.tokens.total + item.tokens.total,
      },
      files: {
        added: total.files.added + item.files.added,
        deleted: total.files.deleted + item.files.deleted,
        modified: total.files.modified + item.files.modified,
      },
      lines: { added: total.lines.added + item.lines.added, deleted: total.lines.deleted + item.lines.deleted },
    }),
    EMPTY_METRICS,
  )
}

export type PhaseStatus = "pending" | "running" | "done" | "failed"
/** Шаги вне фаз — английская исходная строка; экран переводит её как название фазы (#472). */
export const NO_PHASE = "No phase"

/** Фазы в объявленном порядке со своими шагами; шаги вне фаз — «Без фазы» в конце. */
export function phases(declared: readonly string[], steps: readonly Step[]) {
  const names = [...declared, ...(steps.some((step) => !step.phase) ? [NO_PHASE] : [])]
  return names.map((name) => {
    const own = steps.filter((step) => (step.phase ?? NO_PHASE) === name)
    const status: PhaseStatus = own.some((step) => step.status === "failed")
      ? "failed"
      : own.some((step) => step.status === "running" || step.status === "waiting" || step.status === "approval")
        ? "running"
        : own.length
          ? "done"
          : "pending"
    return { name, status, steps: own, metrics: sum(own.map((step) => step.metrics)) }
  })
}

// Слова — английские исходные строки; переводит переданный переводчик (#472), по умолчанию — английский.
const decimal = (value: number, t: BuffI18n.T) => {
  const [whole, fraction] = value.toFixed(1).split(".")
  return fraction === "0" ? whole! : t("{whole}.{fraction}", { whole: whole!, fraction: fraction! })
}

export function tokens(count: number, t: BuffI18n.T = BuffI18n.english): string {
  if (count >= 1_000_000) return t("{value}M", { value: decimal(count / 1_000_000, t) })
  if (count >= 1_000) return t("{value}K", { value: decimal(count / 1_000, t) })
  return String(count)
}

export function metricsText(metrics: Metrics, t: BuffI18n.T = BuffI18n.english): string {
  const files = metrics.files
  return [
    t("{tokens} tokens", { tokens: tokens(metrics.tokens.total, t) }),
    t("files +{added} ~{modified} −{deleted}", files),
    t("lines +{added} −{deleted}", metrics.lines),
  ].join(" · ")
}

const STOPPED: Record<StopReason, string> = {
  user: "Stopped by you",
  model: "Stopped by the agent",
  provider: "Stopped",
  interrupted: "Interrupted: the service closed — you can resume it",
  superseded: "Replaced by the amended run",
}

export function runLabel(run: Pick<Run, "status" | "stopReason" | "error">, t: BuffI18n.T = BuffI18n.english): string {
  if (run.status === "completed") return t("Completed")
  if (run.status === "running") return t("Running")
  if (run.status === "pending") return t("Preparing")
  if (run.status === "errored") return t("Script error: {error}", { error: run.error ?? t("no reason given") })
  if (run.stopReason === "provider")
    return t("Stopped: {error}", { error: run.error ?? t("the model provider failed") })
  return t(STOPPED[run.stopReason ?? "user"])
}

/** Сколько шёл прогон — по отметкам службы: идущий — до «сейчас», законченный — до конца. */
export function elapsed(
  run: Pick<Run, "status" | "created" | "updated" | "finished" | "started" | "spent">,
  now: number,
  t: BuffI18n.T = BuffI18n.english,
): string {
  const end = run.status === "running" || run.status === "pending" ? now : (run.finished ?? run.updated)
  return BuffBackground.elapsed((run.spent ?? 0) + end - (run.started ?? run.created), t)
}

/** Сколько шёл шаг: незаконченный (что бы он ни ждал) — до «сейчас», законченный — до конца. */
export function stepElapsed(
  step: Pick<Step, "started" | "finished">,
  now: number,
  t: BuffI18n.T = BuffI18n.english,
): string {
  return BuffBackground.elapsed((step.finished ?? now) - step.started, t)
}

/** Остановленный (кроме заменённого) продолжается с того же места; ошибка сценария — нет. */
export function resumable(run: Pick<Run, "status" | "stopReason">): boolean {
  return run.status === "stopped" && run.stopReason !== "superseded"
}

/** Действие запроса разрешения от инструментов сценариев: человек подтверждает каждый запуск. */
export const PERMISSION_ACTION = "buff_workflow"
export const PERMISSION_HINT =
  "The agent offers to run a workflow — subagents will work in the background through the phases below and run the listed commands. Check it — confirming starts the run."
export const SAVE_HINT =
  "The agent offers to save the workflow so it can be run later by name. Confirming writes the file."

const AMEND_HINT =
  "The agent is amending a run — the new run replaces the previous one and reuses the finished work of named subagents. Confirming starts the run."
const EVAL_HINT =
  "The agent is checking a piece of a workflow on the project — it will run the listed commands. Confirming starts it."
const VIEWS: Record<string, { readonly title: string; readonly hint: string }> = {
  run: { title: "Run workflow", hint: PERMISSION_HINT },
  amend: { title: "Amend workflow run", hint: AMEND_HINT },
  save: { title: "Save workflow", hint: SAVE_HINT },
  eval: { title: "Check a piece of a workflow", hint: EVAL_HINT },
}

/** Заголовок и пояснение запроса разрешения — по тому, что подтверждается (metadata.kind). */
export function permissionView(
  metadata: Readonly<Record<string, unknown>> | undefined,
  t: BuffI18n.T = BuffI18n.english,
) {
  const kind = typeof metadata?.kind === "string" ? metadata.kind : "run"
  const view = VIEWS[kind] ?? VIEWS.run!
  return { title: t(view.title), hint: t(view.hint) }
}

const phaseLine = (phases: readonly string[], t: BuffI18n.T) =>
  t("Phases: {list}", { list: phases.map((name, index) => `${index + 1}. ${name}`).join(" → ") })

/** Строки подтверждения запуска: что, по каким фазам, какие команды, с какими аргументами, где. */
export function confirmation(
  input: {
    readonly label: string
    readonly phases: readonly string[]
    readonly commands: readonly string[]
    readonly args: Readonly<Record<string, unknown>>
    readonly directory: string
    readonly actors: number
  },
  t: BuffI18n.T = BuffI18n.english,
): string[] {
  const args = Object.entries(input.args)
  return [
    t("Workflow «{label}» in {directory}", { label: input.label, directory: input.directory }),
    ...(input.phases.length ? [phaseLine(input.phases, t)] : []),
    input.commands.length
      ? t("Commands it will run: {commands}", { commands: input.commands.join(", ") })
      : t("Runs no commands"),
    ...(args.length
      ? [t("Arguments: {list}", { list: args.map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(", ") })]
      : []),
    ...(input.actors ? [t("Named actors: {count}", { count: input.actors })] : []),
  ]
}

export function saveConfirmation(
  input: {
    readonly name: string
    readonly description: string
    readonly created: boolean
    readonly phases: readonly string[]
  },
  t: BuffI18n.T = BuffI18n.english,
): string[] {
  const words = { name: input.name, description: input.description }
  return [
    input.created
      ? t("Save new workflow «{name}»: {description}", words)
      : t("Overwrite workflow «{name}»: {description}", words),
    ...(input.phases.length ? [phaseLine(input.phases, t)] : []),
  ]
}
