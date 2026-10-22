export * as BuffSchedule from "./buff-schedule.js"

import { BuffI18n } from "./buff-i18n.js"

/**
 * Расписание автоматизации (#447) — без cron: пять видов, которые человек выбирает в редакторе
 * или называет модели. Время местное — машины, на которой работает служба Buff Code. Здесь же
 * сводка словами, следующий запуск и что делать, если машина была выключена: один запуск «с
 * опозданием» за последний пропущенный срок, остальные сроки считаются пропущенными. Слова —
 * английские исходные строки: экран переводит подписи и передаёт переводчика в составные (#472).
 */

export type Schedule =
  | { readonly kind: "interval"; readonly every: number; readonly unit: "minutes" | "hours" }
  | { readonly kind: "daily"; readonly at: string }
  | { readonly kind: "weekly"; readonly days: readonly number[]; readonly at: string }
  | { readonly kind: "weeks"; readonly every: number; readonly days: readonly number[]; readonly at: string }
  | { readonly kind: "monthly"; readonly day: number; readonly at: string }

export const KINDS: readonly { readonly value: Schedule["kind"]; readonly label: string }[] = [
  { value: "interval", label: "Every N minutes or hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "On days of the week" },
  { value: "weeks", label: "Every N weeks" },
  { value: "monthly", label: "Monthly" },
]

/** Дни недели в порядке редактора — с понедельника; значение — как у `Date.getDay()`. */
export const DAYS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
]

export const MAX_EVERY = 200
/** Срок, пропущенный дольше этого, — запуск «с опозданием» (служба проверяет сроки чаще). */
export const LATE_AFTER_MS = 2 * 60_000

const MINUTE = 60_000
const DAY_MS = 24 * 60 * MINUTE
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

const join = (items: readonly string[], t: BuffI18n.T) =>
  items.length < 2
    ? items.join("")
    : t("{items} and {last}", { items: items.slice(0, -1).join(", "), last: items[items.length - 1]! })

function daysWords(days: readonly number[], t: BuffI18n.T): string {
  const set = new Set(days)
  if (set.size === 7) return t("every day")
  if (set.size === 5 && [1, 2, 3, 4, 5].every((day) => set.has(day))) return t("on weekdays")
  if (set.size === 2 && set.has(0) && set.has(6)) return t("on weekends")
  const names = DAYS.filter((day) => set.has(day.value)).map((day) => t(day.label))
  return t("on {days}", { days: join(names, t) })
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Сводка словами: «Every 2 hours» / «Каждые 2 часа», «Раз в 2 недели по пн и чт в 09:00». */
export function summary(
  schedule: Schedule,
  t: BuffI18n.T = BuffI18n.english,
  n: BuffI18n.N = BuffI18n.englishPlural,
): string {
  switch (schedule.kind) {
    case "interval": {
      if (schedule.every === 1) return schedule.unit === "minutes" ? t("Every minute") : t("Every hour")
      return schedule.unit === "minutes"
        ? n(schedule.every, "Every {n} minute|Every {n} minutes")
        : n(schedule.every, "Every {n} hour|Every {n} hours")
    }
    case "daily":
      return t("Daily at {at}", { at: schedule.at })
    case "weekly":
      return t("{days} at {at}", { days: capital(daysWords(schedule.days, t)), at: schedule.at })
    case "weeks": {
      const period = schedule.every === 1 ? t("Every week") : n(schedule.every, "Every {n} week|Every {n} weeks")
      return t("{period} {days} at {at}", { period, days: daysWords(schedule.days, t), at: schedule.at })
    }
    case "monthly":
      return schedule.day > 28
        ? t("Monthly on day {day} at {at} (in shorter months — on the last day)", {
            day: schedule.day,
            at: schedule.at,
          })
        : t("Monthly on day {day} at {at}", { day: schedule.day, at: schedule.at })
  }
}

/** Что не так с расписанием — словами для редактора; `undefined` — всё в порядке. */
export function problem(schedule: Schedule, t: BuffI18n.T = BuffI18n.english): string | undefined {
  if ((schedule.kind === "interval" || schedule.kind === "weeks") && !between(schedule.every, 1, MAX_EVERY))
    return t("Interval — from 1 to {max}.", { max: MAX_EVERY })
  if (schedule.kind !== "interval" && !TIME.test(schedule.at)) return t("Time — as HH:MM, for example 09:00.")
  if ((schedule.kind === "weekly" || schedule.kind === "weeks") && !schedule.days.some((day) => between(day, 0, 6)))
    return t("Choose at least one day of the week.")
  if (schedule.kind === "monthly" && !between(schedule.day, 1, 31)) return t("Day of the month — from 1 to 31.")
  return undefined
}

const between = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high

const period = (schedule: { every: number; unit: "minutes" | "hours" }) =>
  schedule.every * (schedule.unit === "minutes" ? MINUTE : 60 * MINUTE)

function atTime(day: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes)
}

const weekStart = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7))
const lastDay = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()

function matches(schedule: Exclude<Schedule, { kind: "interval" }>, day: Date, anchor: Date): boolean {
  switch (schedule.kind) {
    case "daily":
      return true
    case "weekly":
      return schedule.days.includes(day.getDay())
    case "weeks": {
      const weeks = Math.round((weekStart(day).getTime() - weekStart(anchor).getTime()) / (7 * DAY_MS))
      return weeks % schedule.every === 0 && schedule.days.includes(day.getDay())
    }
    case "monthly":
      return day.getDate() === Math.min(schedule.day, lastDay(day))
  }
}

/**
 * Первый срок позже `after`. `anchor` — когда автоматизацию создали: от него идут интервалы и
 * счёт недель «раз в N недель». Расписание должно быть без ошибок (`problem`).
 */
export function next(schedule: Schedule, anchor: Date, after: Date): Date {
  const trouble = problem(schedule)
  if (trouble) throw new Error(trouble)
  if (schedule.kind === "interval") {
    const step = period(schedule)
    const count = Math.max(1, Math.floor((after.getTime() - anchor.getTime()) / step) + 1)
    return new Date(anchor.getTime() + count * step)
  }
  for (let offset = 0; ; offset++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset)
    const candidate = atTime(day, schedule.at)
    if (candidate > after && matches(schedule, day, anchor)) return candidate
  }
}

export interface Due {
  /** Срок, за который идёт запуск, — последний из наступивших. */
  readonly at: Date
  /** Сколько более ранних сроков прошло без запуска (машина была выключена). */
  readonly skipped: number
  readonly late: boolean
}

/** Наступил ли ожидаемый срок `pending` к `now` — и сколько сроков за это время прошло. */
export function due(schedule: Schedule, anchor: Date, pending: Date, now: Date): Due | undefined {
  if (pending > now) return undefined
  const result = (at: Date, count: number): Due => ({
    at,
    skipped: count - 1,
    late: now.getTime() - at.getTime() > LATE_AFTER_MS,
  })
  if (schedule.kind === "interval") {
    const step = period(schedule)
    const first = Math.ceil((pending.getTime() - anchor.getTime()) / step)
    const last = Math.floor((now.getTime() - anchor.getTime()) / step)
    return result(new Date(anchor.getTime() + last * step), last - first + 1)
  }
  const walk = (at: Date, count: number): Due => {
    const following = next(schedule, anchor, at)
    return following > now ? result(at, count) : walk(following, count + 1)
  }
  return walk(pending, 1)
}

const two = (value: number) => String(value).padStart(2, "0")
const clock = (date: Date) => `${two(date.getHours())}:${two(date.getMinutes())}`
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Когда следующий запуск — коротко: «через 12 мин», «завтра в 09:00», «пн 12.10 в 09:00». */
export function nextLabel(at: Date, now: Date, t: BuffI18n.T = BuffI18n.english): string {
  const minutes = Math.ceil((at.getTime() - now.getTime()) / MINUTE)
  if (minutes <= 0) return t("now")
  if (minutes < 60) return t("in {minutes} min", { minutes })
  if (sameDay(at, now)) return t("today at {time}", { time: clock(at) })
  if (sameDay(at, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)))
    return t("tomorrow at {time}", { time: clock(at) })
  const day = DAYS.find((entry) => entry.value === at.getDay())?.label ?? ""
  return t("{day} {date} at {time}", {
    day: t(day),
    date: `${two(at.getDate())}.${two(at.getMonth() + 1)}`,
    time: clock(at),
  })
}
