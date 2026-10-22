// Остаток и расход в Buff Code (#455): что пришло от бэкенда, какими словами это сказать
// и сколько стоит сессия по ценам тарифа.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffBilling } from "../src/buff-billing.js"

// #472: строки схемы — английские исходные; ожидания — по-русски, через общий каталог.
const ru: BuffI18n.T = (s, p) => BuffI18n.t("ru", s, p)
const rn: BuffI18n.N = (c, f, p) => BuffI18n.n("ru", c, f, p)

const REPLY = {
  ok: true,
  billing: {
    org: "acme",
    balance_rub: 1234.5,
    days_left: 12.4,
    low: false,
    exhausted: false,
    tariff: "Команда",
    price_input_rub_per_m: 90,
    price_output_rub_per_m: 180,
    mine: {
      window_days: 30,
      total_rub: 150,
      days: [
        { day: "2026-10-01", rub: 100 },
        { day: "2026-10-03", rub: 50 },
      ],
    },
    cabinet_url: "https://dev.example/app",
  },
}
const info = (over: Record<string, unknown> = {}) =>
  BuffBilling.fromReply({ ok: true, billing: { ...REPLY.billing, ...over } })!

describe("the backend's answer", () => {
  test("is read into what the interface shows", () => {
    expect(BuffBilling.fromReply(REPLY)).toEqual({
      org: "acme",
      balanceRub: 1234.5,
      daysLeft: 12.4,
      low: false,
      exhausted: false,
      tariff: "Команда",
      priceInputRubPerM: 90,
      priceOutputRubPerM: 180,
      mine: {
        windowDays: 30,
        totalRub: 150,
        days: [
          { day: "2026-10-01", rub: 100 },
          { day: "2026-10-03", rub: 50 },
        ],
      },
      cabinetUrl: "https://dev.example/app",
    })
  })
  test("an answer without a balance is no answer — never a zero", () => {
    expect(BuffBilling.fromReply({ ok: true })).toBeUndefined()
    expect(BuffBilling.fromReply({ ok: true, billing: { org: "acme" } })).toBeUndefined()
    expect(BuffBilling.fromReply(null)).toBeUndefined()
  })
  test("no spend yet and no tariff prices are told apart from zeros", () => {
    const empty = info({ days_left: null, tariff: null, price_input_rub_per_m: null, price_output_rub_per_m: null })
    expect(empty.daysLeft).toBeNull()
    expect(empty.tariff).toBeNull()
    expect(empty.priceInputRubPerM).toBeNull()
  })
})

describe("money in words", () => {
  test("rubles: thousands apart, kopecks only while they matter", () => {
    expect(BuffBilling.rub(1234.5)).toBe("1 234,50 ₽")
    expect(BuffBilling.rub(1234)).toBe("1 234 ₽")
    expect(BuffBilling.rub(0.037)).toBe("0,04 ₽")
    expect(BuffBilling.rub(0)).toBe("0 ₽")
  })
  test("the balance in one short label", () => {
    expect(BuffBilling.balanceLabel(info(), ru)).toBe("1 234,50 ₽")
    expect(BuffBilling.balanceLabel(info({ low: true, days_left: 2.2 }), ru)).toBe("1 234,50 ₽ · ≈ 2 дн.")
    expect(BuffBilling.balanceLabel(info({ balance_rub: 0, exhausted: true, days_left: 0 }), ru)).toBe(
      "средства закончились",
    )
  })
  test("how long it lasts", () => {
    expect(BuffBilling.runway(info(), ru, rn)).toBe("хватит примерно на 12 дн. при расходе организации за 30 дней")
    expect(BuffBilling.runway(info({ days_left: 0.4, low: true }), ru, rn)).toBe(
      "хватит меньше чем на день при расходе организации за 30 дней",
    )
    expect(BuffBilling.runway(info({ days_left: null }), ru, rn)).toBe("расхода за 30 дней нет — оценить запас не по чему")
    expect(BuffBilling.runway(info({ balance_rub: 0, exhausted: true, days_left: 0 }), ru, rn)).toBe("средства закончились")
  })
  test("how long it lasts, short — for the console's narrow lists", () => {
    expect(BuffBilling.runwayShort(info(), ru)).toBe("≈ 12 дн.")
    expect(BuffBilling.runwayShort(info({ days_left: 0.4, low: true }), ru)).toBe("меньше дня")
    expect(BuffBilling.runwayShort(info({ days_left: null }), ru)).toBe("расхода не было")
    expect(BuffBilling.runwayShort(info({ balance_rub: 0, exhausted: true, days_left: 0 }), ru)).toBe("закончились")
  })
  test("a warning only when funds are low or gone", () => {
    expect(BuffBilling.warning(info(), ru)).toBeUndefined()
    expect(BuffBilling.warning(info({ low: true, days_left: 2.2 }), ru)).toBe(
      "Средств организации acme хватит примерно на 2 дн. Пополните баланс в кабинете Buff.",
    )
    expect(BuffBilling.warning(info({ low: true, days_left: 0.3 }), ru)).toBe(
      "Средств организации acme хватит меньше чем на день. Пополните баланс в кабинете Buff.",
    )
    expect(BuffBilling.warning(info({ balance_rub: -3, exhausted: true, days_left: 0 }), ru)).toBe(
      "Средства организации acme закончились: модель не ответит, пока баланс не пополнен в кабинете Buff.",
    )
  })
})

describe("what a session costs", () => {
  const tokens = { input: 1_000_000, output: 100_000, reasoning: 100_000, cache: { read: 500_000, write: 0 } }
  test("the tokens at the tariff's prices; cached input is priced as input — an upper estimate", () => {
    // 1.5M input × 90 + 0.2M output × 180
    expect(BuffBilling.sessionRub(tokens, info())).toBe(171)
    expect(BuffBilling.sessionCost(tokens, info())).toBe("≈ 171 ₽")
  })
  test("no prices or no tokens — nothing to show rather than a zero", () => {
    expect(BuffBilling.sessionRub(tokens, info({ price_input_rub_per_m: null }))).toBeUndefined()
    expect(BuffBilling.sessionCost(tokens, undefined)).toBeUndefined()
    const none = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
    expect(BuffBilling.sessionCost(none, info())).toBeUndefined()
  })
})

describe("my spend by day", () => {
  test("every day of the window ending today, days without spend included; bars scaled to the largest", () => {
    const rows = BuffBilling.spendDays(
      info({ mine: { window_days: 4, total_rub: 150, days: REPLY.billing.mine.days } }).mine,
      "2026-10-03",
    )
    expect(rows).toEqual([
      { day: "2026-09-30", rub: 0, share: 0 },
      { day: "2026-10-01", rub: 100, share: 1 },
      { day: "2026-10-02", rub: 0, share: 0 },
      { day: "2026-10-03", rub: 50, share: 0.5 },
    ])
  })
  test("a day is said the short way", () => {
    expect(BuffBilling.dayLabel("2026-10-03")).toBe("03.10")
  })
})
