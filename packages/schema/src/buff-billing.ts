export * as BuffBilling from "./buff-billing.js"

import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"
import { define } from "./rpc.js"

/**
 * Остаток и расход в Buff Code (#455). Разработчик видит остаток организации, на сколько его
 * хватит, цены тарифа и свой расход по дням — в рублях; пополняется баланс в кабинете. Что
 * «мало», решает бэкенд (хватит меньше чем на три дня), а здесь — как это прочитать и сказать,
 * одинаково в окне и в консоли. Читает ядро через шлюз коннектора (`core/src/buff/billing.ts`).
 */

const Day = Schema.Struct({ day: Schema.String, rub: Schema.Number })

export const Info = Schema.Struct({
  org: Schema.String,
  balanceRub: Schema.Number,
  /** null — организация за окно ничего не потратила, запас оценить не по чему. */
  daysLeft: Schema.NullOr(Schema.Number),
  low: Schema.Boolean,
  exhausted: Schema.Boolean,
  tariff: Schema.NullOr(Schema.String),
  priceInputRubPerM: Schema.NullOr(Schema.Number),
  priceOutputRubPerM: Schema.NullOr(Schema.Number),
  /** Расход самого разработчика. */
  mine: Schema.Struct({ windowDays: Schema.Number, totalRub: Schema.Number, days: Schema.Array(Day) }),
  cabinetUrl: Schema.String,
})
export type Info = typeof Info.Type

const portable = Schema.toStandardSchemaV1
const Reason = portable(Schema.Struct({}))

export const Rpc = define({
  id: "buff.billing",
  methods: {
    /** Свежие сведения для выбранной в каталоге организации. */
    get: {
      input: portable(Schema.Undefined),
      output: portable(Info),
      errors: { signed_out: Reason, no_context: Reason, unreachable: Reason },
    },
  },
  events: {},
})

// --- ответ бэкенда --------------------------------------------------------------------------

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined)

/** Ответ шлюза → сведения. Без остатка ответа нет: ноль вместо неизвестного показывать нельзя. */
export function fromReply(reply: unknown): Info | undefined {
  const b = (reply as { billing?: Record<string, unknown> } | null)?.billing
  const org = text(b?.org)
  const balanceRub = number(b?.balance_rub)
  if (!b || !org || balanceRub === undefined) return undefined
  const mine = (b.mine ?? {}) as Record<string, unknown>
  return {
    org,
    balanceRub,
    daysLeft: number(b.days_left) ?? null,
    low: b.low === true,
    exhausted: b.exhausted === true,
    tariff: text(b.tariff) ?? null,
    priceInputRubPerM: number(b.price_input_rub_per_m) ?? null,
    priceOutputRubPerM: number(b.price_output_rub_per_m) ?? null,
    mine: {
      windowDays: number(mine.window_days) ?? 30,
      totalRub: number(mine.total_rub) ?? 0,
      days: (Array.isArray(mine.days) ? mine.days : []).flatMap((entry) => {
        const { day, rub } = (entry ?? {}) as { day?: unknown; rub?: unknown }
        const amount = number(rub)
        return typeof day === "string" && amount !== undefined ? [{ day, rub: amount }] : []
      }),
    },
    cabinetUrl: text(b.cabinet_url) ?? "",
  }
}

// --- слова ----------------------------------------------------------------------------------

/** Сумма в рублях: тысячи через пробел, копейки — только когда они есть. */
export function rub(amount: number): string {
  const rounded = Math.round(amount * 100) / 100
  const [whole, fraction] = Math.abs(rounded).toFixed(2).split(".")
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return `${rounded < 0 ? "−" : ""}${grouped}${fraction === "00" ? "" : `,${fraction}`} ₽`
}

// Слова — через переводчика экрана (#472); без него — английские исходные строки.
const days = (left: number, t: BuffI18n.T): string =>
  left < 1 ? t("for less than a day") : t("for about {n} d.", { n: Math.floor(left) })
const window = (info: Info, n: BuffI18n.N): string => n(info.mine.windowDays, "{n} day|{n} days")

/** Остаток одной короткой подписью — у выбора модели и в строке состояния консоли. */
export function balanceLabel(info: Info, t: BuffI18n.T = BuffI18n.english): string {
  if (info.exhausted) return t("funds have run out")
  if (info.low && info.daysLeft !== null)
    return `${rub(info.balanceRub)} · ${info.daysLeft < 1 ? t("< 1 d.") : t("≈ {n} d.", { n: Math.floor(info.daysLeft) })}`
  return rub(info.balanceRub)
}

/** На сколько хватит остатка — словами. */
export function runway(info: Info, t: BuffI18n.T = BuffI18n.english, n: BuffI18n.N = BuffI18n.englishPlural): string {
  if (info.exhausted) return t("funds have run out")
  if (info.daysLeft === null)
    return t("no spending in {window} — nothing to estimate the runway by", { window: window(info, n) })
  return t("enough {days} at the organization's spending over {window}", {
    days: days(info.daysLeft, t),
    window: window(info, n),
  })
}

/** На сколько хватит — коротко, для узких списков консоли. */
export function runwayShort(info: Info, t: BuffI18n.T = BuffI18n.english): string {
  if (info.exhausted) return t("ran out")
  if (info.daysLeft === null) return t("no spending yet")
  return info.daysLeft < 1 ? t("less than a day") : t("≈ {n} d.", { n: Math.floor(info.daysLeft) })
}

/** Предупреждение, когда средств мало или нет; иначе ничего. */
export function warning(info: Info, t: BuffI18n.T = BuffI18n.english): string | undefined {
  if (info.exhausted)
    return t(
      "The funds of organization {org} have run out: the model will not answer until the balance is topped up in the Buff cabinet.",
      { org: info.org },
    )
  if (info.low && info.daysLeft !== null) {
    const left = days(info.daysLeft, t)
    return t("The funds of organization {org} will last {left}{dot} Top up the balance in the Buff cabinet.", {
      org: info.org,
      left,
      dot: left.endsWith(".") ? "" : ".",
    })
  }
  return undefined
}

// --- стоимость сессии -----------------------------------------------------------------------

export interface Tokens {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: { readonly read: number; readonly write: number }
}

/**
 * Сколько стоит сессия по ценам тарифа — оценка: списание считает бэкенд. Вход из кеша
 * оценивается как обычный вход, так что настоящая сумма не больше показанной.
 */
export function sessionRub(tokens: Tokens, info: Info | undefined): number | undefined {
  if (!info || info.priceInputRubPerM === null || info.priceOutputRubPerM === null) return undefined
  const input = tokens.input + tokens.cache.read + tokens.cache.write
  const output = tokens.output + tokens.reasoning
  if (input + output <= 0) return undefined
  return Math.round(((input * info.priceInputRubPerM + output * info.priceOutputRubPerM) / 1_000_000) * 100) / 100
}

/** Та же оценка подписью: «≈ 12,30 ₽». */
export function sessionCost(tokens: Tokens, info: Info | undefined): string | undefined {
  const amount = sessionRub(tokens, info)
  return amount === undefined ? undefined : `≈ ${rub(amount)}`
}

// --- расход по дням -------------------------------------------------------------------------

export interface SpendDay {
  readonly day: string
  readonly rub: number
  /** Доля от самого дорогого дня окна — длина полосы. */
  readonly share: number
}

/** Каждый день окна до `today` включительно (ГГГГ-ММ-ДД), дни без расхода — нулями. */
export function spendDays(mine: Info["mine"], today: string): SpendDay[] {
  const spent = new Map(mine.days.map((entry) => [entry.day, entry.rub]))
  const top = Math.max(0, ...mine.days.map((entry) => entry.rub))
  const end = Date.parse(`${today}T00:00:00Z`)
  return Array.from({ length: mine.windowDays }, (_, index) => {
    const day = new Date(end - (mine.windowDays - 1 - index) * 86_400_000).toISOString().slice(0, 10)
    const amount = spent.get(day) ?? 0
    return { day, rub: amount, share: top > 0 ? amount / top : 0 }
  })
}

/** День коротко: «03.10». */
export function dayLabel(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`
}
