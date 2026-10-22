export * as BuffAutomation from "./buff-automation.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { BuffI18n } from "./buff-i18n.js"
import { BuffPermissionMode } from "./buff-permission-mode.js"
import { BuffSchedule } from "./buff-schedule.js"

/**
 * Автоматизации (#447): задача агенту по расписанию. Запускает их служба Buff Code на машине
 * разработчика — и при закрытом окне. Каждый запуск — отдельная сессия в проекте с режимом
 * разрешений автоматизации; если запуск всё же спросил разрешение, он «ждёт разрешения», пока
 * человек не ответит в сессии. В истории видно всё: сбой — с причиной, остановленный человеком —
 * не успех, пропущенные, пока машина была выключена, — отдельной строкой.
 */

const portable = Schema.toStandardSchemaV1

// Описания полей видит и модель: схема — вход инструмента «создать автоматизацию».
const Time = Schema.String.annotate({ description: "Local time HH:MM, 24-hour" })
const Days = Schema.Array(Schema.Number).annotate({ description: "Days of week, 0 = Sunday … 6 = Saturday" })
const Every = Schema.Number.annotate({ description: `1 to ${BuffSchedule.MAX_EVERY}` })
export const Schedule = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("interval"), every: Every, unit: Schema.Literals(["minutes", "hours"]) }),
  Schema.Struct({ kind: Schema.Literal("daily"), at: Time }),
  Schema.Struct({ kind: Schema.Literal("weekly"), days: Days, at: Time }),
  Schema.Struct({ kind: Schema.Literal("weeks"), every: Every, days: Days, at: Time }),
  Schema.Struct({ kind: Schema.Literal("monthly"), day: Schema.Number.annotate({ description: "1 to 31" }), at: Time }),
])

export const Mode = Schema.Literals(["ask", "edit", "full"])
export const ModelRef = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  variant: Schema.optional(Schema.String),
})

export const Draft = Schema.Struct({
  title: Schema.String,
  /** Самодостаточная задача: запуск идёт в новой сессии без переписки, из которой его создали. */
  prompt: Schema.String,
  schedule: Schedule,
  /** Каталог проекта, в котором идёт запуск. */
  directory: Schema.String,
  mode: Mode,
  /** Без модели — модель проекта по умолчанию. */
  model: Schema.optional(ModelRef),
})
export type Draft = typeof Draft.Type

export const RunStatus = Schema.Literals(["running", "waiting", "succeeded", "failed", "stopped", "skipped"])
export type RunStatus = typeof RunStatus.Type

export const Run = Schema.Struct({
  id: Schema.String,
  automation: Schema.String,
  /** Срок по расписанию (для запуска вручную — когда нажали). */
  due: Schema.Number,
  started: Schema.Number,
  finished: Schema.optional(Schema.Number),
  status: RunStatus,
  source: Schema.Literals(["schedule", "manual"]),
  late: Schema.optional(Schema.Boolean),
  /** Для строки «пропущено» — сколько сроков прошло без запуска. */
  skipped: Schema.optional(Schema.Number),
  /** Почему пропущено; без причины — машина была выключена. */
  reason: Schema.optional(Schema.String),
  session: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})
export type Run = typeof Run.Type

export const Automation = Schema.Struct({
  ...Draft.fields,
  id: Schema.String,
  paused: Schema.Boolean,
  created: Schema.Number,
  /** От чего считаются интервалы и недели «раз в N недель»: создание или последняя смена расписания. */
  anchor: Schema.Number,
  /** Ожидаемый срок; служба запускает, когда он наступил. */
  next: Schema.Number,
  /** Сколько раз запускалась (пропуски не в счёт). */
  count: Schema.Number,
  last: Schema.optional(Run),
})
export type Automation = typeof Automation.Type

const Id = Schema.Struct({ id: Schema.String })
const Saved = Schema.Struct({ automation: Schema.optional(Automation), problem: Schema.optional(Schema.String) })

export const Rpc = define({
  id: "buff.automation",
  methods: {
    list: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Struct({ automations: Schema.Array(Automation) })),
    },
    /** Создать (без `id`) или изменить. Ошибка в черновике — `problem` словами. */
    save: {
      input: portable(Schema.Struct({ id: Schema.optional(Schema.String), draft: Draft })),
      output: portable(Saved),
    },
    remove: { input: portable(Id), output: portable(Schema.Struct({ removed: Schema.Boolean })) },
    pause: { input: portable(Schema.Struct({ id: Schema.String, paused: Schema.Boolean })), output: portable(Saved) },
    /** Запустить сейчас, вне расписания. Идущий запуск не дублируется — `problem`. */
    run: {
      input: portable(Id),
      output: portable(Schema.Struct({ run: Schema.optional(Run), problem: Schema.optional(Schema.String) })),
    },
    /** Остановить идущий запуск. */
    stop: { input: portable(Id), output: portable(Schema.Struct({ stopped: Schema.Boolean })) },
    runs: { input: portable(Id), output: portable(Schema.Struct({ runs: Schema.Array(Run) })) },
    removeRun: {
      input: portable(Schema.Struct({ id: Schema.String, run: Schema.String })),
      output: portable(Schema.Struct({ removed: Schema.Boolean })),
    },
  },
  events: {},
})

// Причины пишутся в историю английской строкой и переводятся при показе (#472).
export const BUSY = "the previous run was still going"
export const ALREADY_RUNNING = "A run is already in progress — wait for it or stop it."
/** Служба прерывает сессию, простоявшую час без событий (`LocationActivity`). */
export const INACTIVE_WAITING =
  "Permission was awaited for more than an hour — the service stopped the run. Open the session and continue yourself."
export const INACTIVE = "The run showed no signs of life for an hour — the service stopped it."

/** Действие запроса разрешения от инструмента модели «создать автоматизацию». */
export const PERMISSION_ACTION = "buff_automation"
export const PERMISSION_HINT =
  "The agent proposes an automation — a task Buff Code will run by itself on a schedule. Check what, when and where — confirming creates it."

/** Метаданные сессии запуска — по ним окно узнаёт запуск автоматизации. */
export const SESSION_KEY = "buffAutomation"
export const DEFAULT_MODE: BuffPermissionMode.Mode = "edit"

const RUN_WORDS: Record<RunStatus, string> = {
  running: "Running",
  waiting: "Waiting for permission",
  succeeded: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  skipped: "Skipped",
}

/** Запуск словами: сбой — с причиной, пропуск — сколько сроков. Причина из истории тоже переводится. */
export function runLabel(
  run: Pick<Run, "status" | "late" | "skipped" | "error" | "reason">,
  t: BuffI18n.T = BuffI18n.english,
  n: BuffI18n.N = BuffI18n.englishPlural,
): string {
  if (run.status === "failed") {
    const error = run.error?.trim()
    return t("Failed: {reason}", { reason: error ? t(error) : t("no reason came — open the session") })
  }
  if (run.status === "skipped")
    return n(run.skipped ?? 1, "Skipped: {n} run ({reason})|Skipped: {n} runs ({reason})", {
      reason: t(run.reason ?? "the machine was off"),
    })
  return run.late ? t("{status} (late)", { status: t(RUN_WORDS[run.status]) }) : t(RUN_WORDS[run.status])
}

export type State = "active" | "running" | "waiting" | "failed" | "paused"

export function stateOf(automation: {
  readonly paused: boolean
  readonly last?: { readonly status: RunStatus } | undefined
}): State {
  // Идущий запуск (в том числе ручной у автоматизации на паузе) важнее паузы: его можно остановить.
  const status = automation.last?.status
  if (status === "running" || status === "waiting") return status
  if (automation.paused) return "paused"
  return status === "failed" ? "failed" : "active"
}

export type Filter = "all" | Exclude<State, "active">
export const FILTERS: readonly { readonly value: Filter; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Now running" },
  { value: "waiting", label: "Awaiting permission" },
  { value: "failed", label: "With errors" },
  { value: "paused", label: "Paused" },
]

export function matches(filter: Filter, automation: Parameters<typeof stateOf>[0]): boolean {
  return filter === "all" || stateOf(automation) === filter
}

/** Что не так с черновиком — словами; `undefined` — можно сохранять. */
export function draftProblem(draft: Draft, t: BuffI18n.T = BuffI18n.english): string | undefined {
  if (!draft.title.trim()) return t("Name the automation.")
  if (!draft.prompt.trim()) return t("Write what the agent should do.")
  if (!draft.directory.trim()) return t("Choose a project.")
  return BuffSchedule.problem(draft.schedule, t)
}

/** Что человек подтверждает, когда автоматизацию создаёт модель: что, когда, где. */
export function confirmation(
  draft: Draft,
  t: BuffI18n.T = BuffI18n.english,
  n: BuffI18n.N = BuffI18n.englishPlural,
): string {
  return [
    t("«{title}» — {schedule}, in {directory}, mode «{mode}».", {
      title: draft.title,
      schedule: BuffSchedule.summary(draft.schedule, t, n),
      directory: draft.directory,
      mode: BuffPermissionMode.short(draft.mode, t),
    }),
    t("Task: {prompt}", { prompt: draft.prompt }),
  ].join("\n")
}
