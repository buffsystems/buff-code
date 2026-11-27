export * as BuffSubscription from "./buff-subscription.js"

import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"
import { define } from "./rpc.js"

/**
 * Подписка личного аккаунта Buff в Buff Code (#966): уровни моделей, тариф и окна расхода.
 * Человек видит только уровни («Быстрая», «Оптимальная», «Сильная», «Гениальная») — настоящих
 * имён моделей сервер не называет. Окна общие для сайта, телефона и компьютера. Здесь — как
 * прочитать ответы сервера и какими словами это сказать, одинаково в окне и в консоли;
 * читает ядро (`core/src/buff/account.ts`).
 */

export const Status = Schema.Literals(["active", "grace", "blocked", "none"])
export type Status = typeof Status.Type

export const Plan = Schema.Struct({
  status: Status,
  /** Имя тарифа по-русски и по-английски; тарифа нет — null. */
  name: Schema.NullOr(Schema.String),
  nameEn: Schema.NullOr(Schema.String),
  /** До какого времени действует (ISO); неизвестно — null. */
  activeUntil: Schema.NullOr(Schema.String),
})
export type Plan = typeof Plan.Type

export const Window = Schema.Struct({
  /** `5h`, `week` — или новое окно сервера, которое покажем под его идентификатором. */
  id: Schema.String,
  usedPct: Schema.Number,
  /** Когда окно обновится (ISO); null — расход ещё не начат. */
  resetAt: Schema.NullOr(Schema.String),
})
export type Window = typeof Window.Type

export const Usage = Schema.Struct({
  login: Schema.NullOr(Schema.String),
  plan: Plan,
  windows: Schema.Array(Window),
})
export type Usage = typeof Usage.Type

const portable = Schema.toStandardSchemaV1
const Reason = portable(Schema.Struct({}))

export const Rpc = define({
  id: "buff.subscription",
  methods: {
    /** Свежий расход подписки того, кто вошёл в аккаунт Buff. */
    get: {
      input: portable(Schema.Undefined),
      output: portable(Usage),
      errors: { signed_out: Reason, unreachable: Reason },
    },
  },
  events: {},
})

// --- ответы сервера -------------------------------------------------------------------------

type Raw = Record<string, unknown>
const record = (value: unknown): Raw => (value !== null && typeof value === "object" ? (value as Raw) : {})
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined)
const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : []

const STATUSES: readonly string[] = Status.literals

/** `subscription` из ответа сервера; о чём он промолчал — подписки нет. */
export function plan(raw: unknown): Plan {
  const s = record(raw)
  const status = text(s.status)
  return {
    status: status && STATUSES.includes(status) ? (status as Status) : "none",
    name: text(s.plan_name) ?? null,
    nameEn: text(s.plan_name_en) ?? null,
    activeUntil: text(s.active_until) ?? null,
  }
}

/** Уровень модели, как его назвал сервер. */
export interface Tier {
  readonly id: string
  readonly name: string
  readonly nameEn: string
  readonly context?: number
  readonly output?: number
  readonly input: readonly string[]
  readonly outputs: readonly string[]
  readonly tools: boolean
}

/** Пределы большого запроса этой установки (их задаёт оператор): тело, часть, число частей, срок. */
export interface RequestLimits {
  readonly maxBytes: number
  readonly pieceBytes: number
  readonly maxPieces: number
  readonly finishSeconds?: number
}

export interface Models {
  /** Пределы большого запроса; сервер их не назвал — нет. */
  readonly request?: RequestLimits
  readonly tiers: readonly Tier[]
  readonly default: string | null
  readonly small: string | null
  readonly plan: Plan
}

/** Ответ `chat_models` → уровни. Уровень без идентификатора не показывается. */
export function models(reply: unknown): Models {
  const r = record(reply)
  const tiers = (Array.isArray(r.tiers) ? r.tiers : []).flatMap((item): Tier[] => {
    const tier = record(item)
    const id = text(tier.id)
    if (!id) return []
    const context = positive(tier.context)
    const output = positive(tier.max_output)
    const input = strings(tier.input)
    const outputs = strings(tier.output)
    return [
      {
        id,
        name: text(tier.name) ?? id,
        nameEn: text(tier.name_en) ?? text(tier.name) ?? id,
        ...(context ? { context } : {}),
        ...(output ? { output } : {}),
        input: input.length ? input : ["text"],
        outputs: outputs.length ? outputs : ["text"],
        tools: tier.tools !== false,
      },
    ]
  })
  const offered = (value: unknown) => tiers.find((tier) => tier.id === value)?.id ?? null
  const request = requestLimits(r.request)
  return {
    ...(request ? { request } : {}),
    tiers,
    default: offered(r.default),
    small: offered(r.small),
    plan: plan(r.subscription),
  }
}

function requestLimits(raw: unknown): RequestLimits | undefined {
  const limits = record(raw)
  const maxBytes = positive(limits.max_bytes)
  const pieceBytes = positive(limits.piece_bytes)
  const maxPieces = positive(limits.max_pieces)
  const finishSeconds = positive(limits.finish_seconds)
  if (!maxBytes || !pieceBytes || !maxPieces) return undefined
  return { maxBytes, pieceBytes, maxPieces, ...(finishSeconds ? { finishSeconds } : {}) }
}

/** Ответ `chat_usage` → расход. Окно без идентификатора или доли не показывается. */
export function usage(reply: unknown, login: string | null): Usage {
  const r = record(reply)
  return {
    login,
    plan: plan(r.subscription),
    windows: (Array.isArray(r.windows) ? r.windows : []).flatMap((item): Window[] => {
      const window = record(item)
      const id = text(window.id)
      if (!id || typeof window.used_pct !== "number" || !Number.isFinite(window.used_pct)) return []
      return [{ id, usedPct: Math.max(0, Math.round(window.used_pct)), resetAt: text(window.reset_at) ?? null }]
    }),
  }
}

// --- слова ----------------------------------------------------------------------------------

/** Имя уровня на языке человека. */
export const tierName = (tier: Pick<Tier, "name" | "nameEn">, locale: BuffI18n.Locale): string =>
  locale === "ru" ? tier.name : tier.nameEn

/** Имя тарифа на языке человека; у подписки без тарифа его нет. */
export function planName(plan: Plan, locale: BuffI18n.Locale): string | undefined {
  return (locale === "ru" ? (plan.name ?? plan.nameEn) : (plan.nameEn ?? plan.name)) ?? undefined
}

/** Состояние подписки одной фразой. */
export function statusLabel(plan: Plan, t: BuffI18n.T = BuffI18n.english): string {
  if (plan.status === "active") return t("active")
  if (plan.status === "grace") return t("ended — read-only period, models are off")
  if (plan.status === "blocked") return t("access stopped — contact support")
  return t("no subscription")
}

/** Какое это окно. */
export function windowLabel(id: string, t: BuffI18n.T = BuffI18n.english): string {
  if (id === "5h") return t("5-hour limit")
  if (id === "week") return t("Weekly limit")
  return id
}

/** Сколько израсходовано: «12 %». */
export const usedLabel = (window: Window, t: BuffI18n.T = BuffI18n.english): string =>
  t("{pct}% used", { pct: window.usedPct })

/** Через сколько окно обновится — словами; расход не начат — обновляться нечему. */
export function resetLabel(window: Window, now: number, t: BuffI18n.T = BuffI18n.english): string | undefined {
  if (!window.resetAt) return undefined
  const at = Date.parse(window.resetAt)
  if (Number.isNaN(at)) return undefined
  const minutes = Math.ceil((at - now) / 60_000)
  if (minutes <= 0) return t("resets any moment")
  if (minutes < 60) return t("resets in {m} min", { m: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t("resets in {h} h {m} min", { h: hours, m: minutes % 60 })
  return t("resets in {d} d {h} h", { d: Math.floor(hours / 24), h: hours % 24 })
}

/** Самое занятое окно — для короткой подписи в строке состояния. */
export function tightest(usage: Usage): Window | undefined {
  return usage.windows.toSorted((a, b) => b.usedPct - a.usedPct)[0]
}

/** Подписка одной короткой подписью: «5 ч · 12 %». */
export function shortLabel(usage: Usage, t: BuffI18n.T = BuffI18n.english): string | undefined {
  if (usage.plan.status !== "active") return statusLabel(usage.plan, t)
  const window = tightest(usage)
  if (!window) return undefined
  return `${windowShort(window.id, t)} · ${t("{pct}%", { pct: window.usedPct })}`
}

function windowShort(id: string, t: BuffI18n.T): string {
  if (id === "5h") return t("5 h")
  if (id === "week") return t("week")
  return id
}

/** Окно исчерпано или почти — пора сказать человеку. */
export const LOW_PCT = 90
export function warning(usage: Usage, now: number, t: BuffI18n.T = BuffI18n.english): string | undefined {
  const window = tightest(usage)
  if (usage.plan.status !== "active" || !window || window.usedPct < LOW_PCT) return undefined
  const reset = resetLabel(window, now, t)
  const head =
    window.usedPct >= 100
      ? t("{window} is used up", { window: windowLabel(window.id, t) })
      : t("{window}: {used}", { window: windowLabel(window.id, t), used: usedLabel(window, t) })
  return reset ? `${head} — ${reset}.` : `${head}.`
}
