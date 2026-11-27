// Расписание автоматизаций (#447) без cron: сводка словами, следующий запуск, пропуски.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffSchedule } from "../src/buff-schedule.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const ruN: BuffI18n.N = (count, forms, params) => BuffI18n.n("ru", count, forms, params)

// Местное время: 2026-10-05 — понедельник.
const at = (text: string) => new Date(text)
const anchor = at("2026-10-01T08:00:00")

describe("the schedule in words", () => {
  test("each of the five kinds", () => {
    expect(BuffSchedule.summary({ kind: "interval", every: 15, unit: "minutes" }, ru, ruN)).toBe("Каждые 15 минут")
    expect(BuffSchedule.summary({ kind: "interval", every: 1, unit: "hours" }, ru, ruN)).toBe("Каждый час")
    expect(BuffSchedule.summary({ kind: "interval", every: 2, unit: "hours" }, ru, ruN)).toBe("Каждые 2 часа")
    expect(BuffSchedule.summary({ kind: "daily", at: "09:00" }, ru, ruN)).toBe("Ежедневно в 09:00")
    expect(BuffSchedule.summary({ kind: "weekly", days: [1, 4], at: "09:00" }, ru, ruN)).toBe("По пн и чт в 09:00")
    expect(BuffSchedule.summary({ kind: "weekly", days: [1, 2, 3, 4, 5], at: "09:30" }, ru, ruN)).toBe(
      "По будням в 09:30",
    )
    expect(BuffSchedule.summary({ kind: "weeks", every: 2, days: [1, 4], at: "09:00" }, ru, ruN)).toBe(
      "Раз в 2 недели по пн и чт в 09:00",
    )
    expect(BuffSchedule.summary({ kind: "monthly", day: 15, at: "10:00" }, ru, ruN)).toBe("Ежемесячно 15 числа в 10:00")
    expect(BuffSchedule.summary({ kind: "monthly", day: 31, at: "10:00" }, ru, ruN)).toBe(
      "Ежемесячно 31 числа в 10:00 (в коротких месяцах — в последний день)",
    )
  })
})

describe("the schedule in English — the source strings", () => {
  test("words, plurals and the next run", () => {
    expect(BuffSchedule.summary({ kind: "interval", every: 1, unit: "minutes" })).toBe("Every minute")
    expect(BuffSchedule.summary({ kind: "interval", every: 2, unit: "hours" })).toBe("Every 2 hours")
    expect(BuffSchedule.summary({ kind: "weekly", days: [1, 4], at: "09:00" })).toBe("On Mon and Thu at 09:00")
    expect(BuffSchedule.summary({ kind: "weeks", every: 2, days: [6, 0], at: "09:00" })).toBe(
      "Every 2 weeks on weekends at 09:00",
    )
    expect(BuffSchedule.problem({ kind: "weekly", days: [], at: "09:00" })).toBe("Choose at least one day of the week.")
    const now = at("2026-10-05T10:00:00")
    expect(BuffSchedule.nextLabel(at("2026-10-12T09:00:00"), now)).toBe("Mon 12.10 at 09:00")
  })
})

describe("what is wrong with a schedule", () => {
  test("bounds and required parts", () => {
    expect(BuffSchedule.problem({ kind: "interval", every: 0, unit: "minutes" }, ru)).toBe("Интервал — от 1 до 200.")
    expect(BuffSchedule.problem({ kind: "daily", at: "25:00" }, ru)).toBe("Время — в виде ЧЧ:ММ, например 09:00.")
    expect(BuffSchedule.problem({ kind: "weekly", days: [], at: "09:00" }, ru)).toBe(
      "Выберите хотя бы один день недели.",
    )
    expect(BuffSchedule.problem({ kind: "monthly", day: 32, at: "09:00" }, ru)).toBe("Число месяца — от 1 до 31.")
    expect(BuffSchedule.problem({ kind: "daily", at: "09:00" }, ru)).toBeUndefined()
  })
})

describe("the next run", () => {
  const now = at("2026-10-05T10:00:00")
  test("every N minutes or hours — counted from when the automation was created", () => {
    expect(BuffSchedule.next({ kind: "interval", every: 45, unit: "minutes" }, anchor, now)).toEqual(
      at("2026-10-05T10:15:00"),
    )
    expect(BuffSchedule.next({ kind: "interval", every: 5, unit: "hours" }, anchor, now)).toEqual(
      at("2026-10-05T12:00:00"),
    )
  })
  test("daily — today if still ahead, else tomorrow", () => {
    expect(BuffSchedule.next({ kind: "daily", at: "11:00" }, anchor, now)).toEqual(at("2026-10-05T11:00:00"))
    expect(BuffSchedule.next({ kind: "daily", at: "09:00" }, anchor, now)).toEqual(at("2026-10-06T09:00:00"))
  })
  test("by weekdays", () => {
    expect(BuffSchedule.next({ kind: "weekly", days: [1, 4], at: "09:00" }, anchor, now)).toEqual(
      at("2026-10-08T09:00:00"),
    )
    expect(BuffSchedule.next({ kind: "weekly", days: [0], at: "09:00" }, anchor, now)).toEqual(
      at("2026-10-11T09:00:00"),
    )
  })
  test("every N weeks — weeks counted from the week the automation was created", () => {
    // Создана в неделю 28.09–04.10; раз в 2 недели по пн → 12.10, а не 05.10 или 06.10.
    expect(BuffSchedule.next({ kind: "weeks", every: 2, days: [1], at: "09:00" }, anchor, now)).toEqual(
      at("2026-10-12T09:00:00"),
    )
  })
  test("monthly — a day the month lacks becomes its last day", () => {
    expect(BuffSchedule.next({ kind: "monthly", day: 15, at: "10:00" }, anchor, now)).toEqual(at("2026-10-15T10:00:00"))
    expect(BuffSchedule.next({ kind: "monthly", day: 31, at: "10:00" }, anchor, at("2026-11-01T00:00:00"))).toEqual(
      at("2026-11-30T10:00:00"),
    )
  })
})

describe("what is due now", () => {
  const daily = { kind: "daily", at: "09:00" } as const
  test("not yet — nothing", () => {
    expect(BuffSchedule.due(daily, anchor, at("2026-10-05T09:00:00"), at("2026-10-05T08:59:00"))).toBeUndefined()
  })
  test("just now — an ordinary run", () => {
    expect(BuffSchedule.due(daily, anchor, at("2026-10-05T09:00:00"), at("2026-10-05T09:00:20"))).toEqual({
      at: at("2026-10-05T09:00:00"),
      skipped: 0,
      late: false,
    })
  })
  test("the machine was off — one late run for the latest time, the earlier ones skipped", () => {
    expect(BuffSchedule.due(daily, anchor, at("2026-10-02T09:00:00"), at("2026-10-05T10:00:00"))).toEqual({
      at: at("2026-10-05T09:00:00"),
      skipped: 3,
      late: true,
    })
  })
  test("every minute for a week off — counted, not walked", () => {
    const every = { kind: "interval", every: 1, unit: "minutes" } as const
    expect(BuffSchedule.due(every, anchor, at("2026-10-01T09:00:00"), at("2026-10-08T09:00:30"))?.skipped).toBe(
      7 * 24 * 60,
    )
  })
})

describe("when the next run is, said short", () => {
  const now = at("2026-10-05T10:00:00")
  test("soon, today, tomorrow, later", () => {
    expect(BuffSchedule.nextLabel(at("2026-10-05T10:12:00"), now, ru)).toBe("через 12 мин")
    expect(BuffSchedule.nextLabel(at("2026-10-05T18:00:00"), now, ru)).toBe("сегодня в 18:00")
    expect(BuffSchedule.nextLabel(at("2026-10-06T09:00:00"), now, ru)).toBe("завтра в 09:00")
    expect(BuffSchedule.nextLabel(at("2026-10-12T09:00:00"), now, ru)).toBe("пн 12.10 в 09:00")
  })
})

// Живая проверка #969: «17:10», набранное в браузере по Берлину, облачная машина (UTC) считала по
// своим часам. Расписание с поясом считается по поясу человека — и через переход на летнее и
// зимнее время.
describe("a schedule in the person's time zone", () => {
  const berlin = "Europe/Berlin"
  const utc = (text: string) => new Date(text)

  test("a daily time is the person's wall clock, whatever the machine's", () => {
    const next = BuffSchedule.next({ kind: "daily", at: "17:10", zone: berlin }, utc("2026-11-01T00:00:00Z"), utc("2026-11-25T12:00:00Z"))
    expect(next.toISOString()).toBe("2026-11-25T16:10:00.000Z")
  })

  test("across the spring and autumn clock changes the wall time stays", () => {
    const daily = { kind: "daily", at: "09:00", zone: berlin } as const
    const anchor = utc("2026-01-01T00:00:00Z")
    expect(BuffSchedule.next(daily, anchor, utc("2026-03-28T09:00:00Z")).toISOString()).toBe("2026-03-29T07:00:00.000Z")
    expect(BuffSchedule.next(daily, anchor, utc("2026-03-27T09:00:00Z")).toISOString()).toBe("2026-03-28T08:00:00.000Z")
    expect(BuffSchedule.next(daily, anchor, utc("2026-10-24T09:00:00Z")).toISOString()).toBe("2026-10-25T08:00:00.000Z")
  })

  test("a time the spring change skips runs once, an hour later; the autumn's repeated hour runs once", () => {
    const gap = { kind: "daily", at: "02:30", zone: berlin } as const
    const anchor = utc("2026-01-01T00:00:00Z")
    const spring = BuffSchedule.next(gap, anchor, utc("2026-03-28T12:00:00Z"))
    expect(spring.toISOString()).toBe("2026-03-29T01:30:00.000Z")
    const autumn = BuffSchedule.next(gap, anchor, utc("2026-10-24T12:00:00Z"))
    expect(BuffSchedule.next(gap, anchor, autumn).getTime() - autumn.getTime()).toBeGreaterThan(23 * 3600_000)
  })

  test("days of the week and of the month are the person's", () => {
    // 23:30 UTC on Sunday is already Monday in Berlin.
    const monday = { kind: "weekly", days: [1], at: "00:15", zone: berlin } as const
    expect(BuffSchedule.next(monday, utc("2026-01-01T00:00:00Z"), utc("2026-11-22T22:00:00Z")).toISOString()).toBe(
      "2026-11-22T23:15:00.000Z",
    )
    const last = { kind: "monthly", day: 31, at: "00:30", zone: "Asia/Tokyo" } as const
    expect(BuffSchedule.next(last, utc("2026-01-01T00:00:00Z"), utc("2026-11-01T00:00:00Z")).toISOString()).toBe(
      "2026-11-29T15:30:00.000Z",
    )
  })

  test("an unknown zone is a problem; the next run reads in the zone", () => {
    expect(BuffSchedule.problem({ kind: "daily", at: "09:00", zone: "Mars/Olympus" })).toBeDefined()
    expect(BuffSchedule.problem({ kind: "daily", at: "09:00", zone: berlin })).toBeUndefined()
    expect(BuffSchedule.nextLabel(utc("2026-11-25T16:10:00Z"), utc("2026-11-25T12:00:00Z"), undefined, berlin)).toBe(
      "today at 17:10",
    )
  })
})
