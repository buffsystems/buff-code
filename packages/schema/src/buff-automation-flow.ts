export * as BuffAutomationFlow from "./buff-automation-flow.js"

import { BuffAutomation } from "./buff-automation.js"
import { BuffBackground } from "./buff-background.js"
import { BuffI18n } from "./buff-i18n.js"
import type { BuffMcpFlow } from "./buff-mcp-flow.js"
import { BuffPermissionMode } from "./buff-permission-mode.js"
import { BuffSchedule } from "./buff-schedule.js"

/**
 * Автоматизации в консоли (#447): создать и изменить — вопросами по очереди, список со
 * следующим запуском и последним итогом, действия по состоянию, история запусков. Диалоги
 * приходят снаружи, так что шаги проверяются без терминала. `undefined` — человек вышел из
 * вопроса; `problem` — ответ не годится, сохранять нечего. Слова — через переводчика консоли (#472).
 */

type Problem = { readonly problem: string }
type Words = { readonly t: BuffI18n.T; readonly n: BuffI18n.N }
const ENGLISH: Words = { t: BuffI18n.english, n: BuffI18n.englishPlural }
const DAYS_PROBLEM = "Days — short names separated by spaces: {days}, or «{weekdays}», «{weekends}»."

/** Дни недели из строки консоли: «пн чт», «пн, ср, пт», «будни», «выходные» — и то же по-английски. */
export function parseDays(text: string, t: BuffI18n.T = BuffI18n.english): number[] | undefined {
  const same = (word: string, label: string) => word === label.toLowerCase() || word === t(label).toLowerCase()
  const words = text
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
  const days = words.flatMap((word) => {
    if (same(word, "weekdays")) return [1, 2, 3, 4, 5]
    if (same(word, "weekends")) return [6, 0]
    const day = BuffSchedule.DAYS.find((entry) => same(word, entry.label))
    return day ? [day.value] : [Number.NaN]
  })
  return days.length && days.every((day) => !Number.isNaN(day)) ? [...new Set(days)] : undefined
}

export function daysText(days: readonly number[], t: BuffI18n.T = BuffI18n.english): string {
  return BuffSchedule.DAYS.filter((day) => days.includes(day.value))
    .map((day) => t(day.label))
    .join(" ")
}

const daysProblem = (t: BuffI18n.T) =>
  t(DAYS_PROBLEM, {
    days: BuffSchedule.DAYS.map((day) => t(day.label)).join(" "),
    weekdays: t("weekdays"),
    weekends: t("weekends"),
  })

const value = <A>(schedule: BuffSchedule.Schedule | undefined, key: string): A | undefined =>
  schedule && key in schedule ? ((schedule as Record<string, unknown>)[key] as A) : undefined

/** Расписание по шагам: вид, затем только его поля. */
async function schedule(
  ui: BuffMcpFlow.Ui,
  current: BuffSchedule.Schedule | undefined,
  { t }: Words,
): Promise<BuffSchedule.Schedule | Problem | undefined> {
  const kind = await ui.select<BuffSchedule.Schedule["kind"]>({
    title: t("Schedule"),
    options: BuffSchedule.KINDS.map((entry) => ({
      title: t(entry.label),
      value: entry.value,
      ...(entry.value === current?.kind ? { description: t("current") } : {}),
    })),
  })
  if (!kind) return
  const ask = (title: string, key: string, fallback: string) =>
    ui.prompt({ title, value: String(value<unknown>(current, key) ?? fallback) })
  const every = async (title: string) => {
    const text = await ask(title, "every", "1")
    return text === undefined ? undefined : Number(text)
  }
  const days = async () => {
    const text = await ui.prompt({
      title: t("Days of the week"),
      value: daysText(value<number[]>(current, "days") ?? [1], t),
    })
    return text === undefined ? undefined : (parseDays(text, t) ?? daysProblem(t))
  }
  const at = () => ask(t("Time (HH:MM)"), "at", "09:00")

  if (kind === "interval") {
    const count = await every(t("Every N (number)"))
    if (count === undefined) return
    const unit = await ui.select<"minutes" | "hours">({
      title: t("Of what"),
      options: [
        { title: t("minutes"), value: "minutes" },
        { title: t("hours"), value: "hours" },
      ],
    })
    return unit && { kind, every: count, unit }
  }
  if (kind === "daily") {
    const time = await at()
    return time === undefined ? undefined : { kind, at: time }
  }
  if (kind === "monthly") {
    const day = await ask(t("Day of the month"), "day", "1")
    if (day === undefined) return
    const time = await at()
    return time === undefined ? undefined : { kind, day: Number(day), at: time }
  }
  const count = kind === "weeks" ? await every(t("Every N weeks (number)")) : 1
  if (count === undefined) return
  const picked = await days()
  if (picked === undefined) return
  if (typeof picked === "string") return { problem: picked }
  const time = await at()
  if (time === undefined) return
  return kind === "weeks" ? { kind, every: count, days: picked, at: time } : { kind, days: picked, at: time }
}

/** Черновик по шагам. Правка оставляет проект и модель; новая — в каталоге консоли. */
export async function draft(
  ui: BuffMcpFlow.Ui,
  base: BuffAutomation.Draft | undefined,
  directory: string,
  words: Words = ENGLISH,
): Promise<BuffAutomation.Draft | Problem | undefined> {
  const { t } = words
  const title = await ui.prompt({
    title: t("Name"),
    value: base?.title ?? "",
    placeholder: t("Morning report"),
  })
  if (title === undefined) return
  const prompt = await ui.prompt({
    title: t("What the agent should do"),
    description: t("Each run is a new session: the agent does not see this conversation, write the whole task."),
    value: base?.prompt ?? "",
  })
  if (prompt === undefined) return
  const planned = await schedule(ui, base?.schedule, words)
  if (!planned) return
  if ("problem" in planned) return planned
  const trouble = BuffSchedule.problem(planned, t)
  if (trouble) return { problem: trouble }
  const mode = await ui.select<BuffPermissionMode.Mode>({
    title: t("Permissions in a run"),
    options: BuffPermissionMode.MODES.map((entry) => ({
      title: t(entry.label),
      value: entry.value,
      description: t(entry.hint),
    })),
  })
  if (!mode) return
  const result: BuffAutomation.Draft = {
    title,
    prompt,
    schedule: planned,
    directory: base?.directory ?? directory,
    mode,
    ...(base?.model ? { model: base.model } : {}),
  }
  const problem = BuffAutomation.draftProblem(result, t)
  return problem ? { problem } : result
}

const folder = (directory: string) => directory.split(/[\\/]/).filter(Boolean).pop() ?? directory

/** Строка списка: что и где; когда — справа (в узком диалоге описание обрезается). */
export function row(automation: BuffAutomation.Automation, now: Date, { t, n }: Words = ENGLISH) {
  return {
    title: automation.title,
    description: `${BuffSchedule.summary(automation.schedule, t, n)} · ${folder(automation.directory)}`,
    footer: automation.paused ? t("paused") : BuffSchedule.nextLabel(new Date(automation.next), now, t),
    value: automation.id,
  }
}

/** Заголовок окна действий: сколько запусков и чем кончился последний. */
export function actionsTitle(automation: BuffAutomation.Automation, { t, n }: Words = ENGLISH): string {
  const runs = t("{title} · runs: {count}", { title: automation.title, count: automation.count })
  return automation.last
    ? t("{runs} · last: {last}", { runs, last: BuffAutomation.runLabel(automation.last, t, n) })
    : runs
}

export type Action = "run" | "stop" | "open" | "pause" | "resume" | "edit" | "history" | "remove"

export function actions(
  automation: BuffAutomation.Automation,
  t: BuffI18n.T = BuffI18n.english,
): { title: string; value: Action }[] {
  const state = BuffAutomation.stateOf({ paused: false, last: automation.last })
  const going = state === "running" || state === "waiting"
  return [
    going ? { title: t("Stop the run"), value: "stop" as const } : { title: t("Run now"), value: "run" as const },
    ...(automation.last?.session
      ? [
          {
            title: state === "waiting" ? t("Answer in the session") : t("Open the run session"),
            value: "open" as const,
          },
        ]
      : []),
    automation.paused
      ? { title: t("Resume"), value: "resume" as const }
      : { title: t("Pause"), value: "pause" as const },
    { title: t("Edit"), value: "edit" as const },
    { title: t("Run history"), value: "history" as const },
    { title: t("Delete"), value: "remove" as const },
  ]
}

const two = (value: number) => String(value).padStart(2, "0")
const stamp = (ms: number) => {
  const date = new Date(ms)
  return `${two(date.getDate())}.${two(date.getMonth() + 1)} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Строка истории: когда и как запущен; итог; справа — сколько шёл. */
export function historyRow(run: BuffAutomation.Run, now: Date, { t, n }: Words = ENGLISH) {
  const took =
    run.status === "skipped" ? undefined : BuffBackground.since(run.started, run.finished ?? now.getTime(), t)
  return {
    title: `${stamp(run.due)} · ${run.source === "manual" ? t("manually") : t("on schedule")}`,
    description: BuffAutomation.runLabel(run, t, n),
    ...(took ? { footer: took } : {}),
    value: run.id,
  }
}
