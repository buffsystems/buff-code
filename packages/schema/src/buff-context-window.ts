export * as BuffContextWindow from "./buff-context-window.js"

import { BuffI18n } from "./buff-i18n.js"

/**
 * Окно контекста (#836, эпик #783) — потолок контекста на сессию в токенах: сколько диалога
 * модель держит в памяти до уплотнения (core: Session.Info.limit.context). 0 — всё окно модели.
 * Пресеты те же, что в кабинете buff.systems (компактный / средний / большой), плюс свой размер.
 * Здесь слова для людей; подписи — английские исходные строки, переводит экран.
 */

export const TITLE = "Context window"

/** The id of the choice that asks for a custom size. */
export const CUSTOM = "custom"

const PRESETS: readonly { tokens: number; label: string; hint: string }[] = [
  { tokens: 64_000, label: "Compact", hint: "Cheaper and faster: the dialogue is compacted sooner" },
  { tokens: 200_000, label: "Mid-size", hint: "A balance of memory and cost" },
  { tokens: 500_000, label: "Large", hint: "Keeps long work in mind: costlier" },
]

const MAXIMUM = { label: "Model maximum", hint: "The whole window the model has" }
/** The model's window is not known (#898): the number in use is a fallback, and the person is told where to set it. */
const ASSUMED = {
  label: "Window not set, {size}",
  hint: "Set it in Settings → Providers",
}
const OWN = { label: "Own size", hint: "A size of your own, in tokens" }

/** Tokens in short: 64k, 200k, 1M, 1.5M. */
export function format(tokens: number): string {
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`
  return `${Math.floor(tokens / 1_000)}k`
}

function trim(value: number) {
  return (Math.round(value * 10) / 10).toString()
}

/** Tokens as a person would type them back, losing nothing: 1M, 128k, 262144. */
export function exact(tokens: number): string {
  if (tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`
  if (tokens % 1_000 === 0) return `${tokens / 1_000}k`
  return String(tokens)
}

/**
 * The limit's label: a preset by name, the model's maximum (with its size when known), a custom
 * size. `assumed` — the model's size is a fallback nobody named: the maximum says so.
 */
export function label(
  limit: number | undefined,
  model?: number,
  t: BuffI18n.T = BuffI18n.english,
  assumed = false,
): string {
  if (!limit && model && assumed) return t(ASSUMED.label, { size: format(model) })
  if (!limit) return model ? `${t(MAXIMUM.label)}, ${format(model)}` : t(MAXIMUM.label)
  const preset = PRESETS.find((item) => item.tokens === limit)
  return `${t(preset?.label ?? OWN.label)}, ${format(limit)}`
}

/** What the limit changes, in a line. */
export function hint(limit: number | undefined, t: BuffI18n.T = BuffI18n.english, assumed = false): string {
  if (!limit) return t(assumed ? ASSUMED.hint : MAXIMUM.hint)
  const preset = PRESETS.find((item) => item.tokens === limit)
  return t(preset?.hint ?? OWN.hint)
}

export type Option = { id: string; label: string; hint: string }

/**
 * The choices for a control: the model's maximum, the presets that fit the model's window (all of
 * them when it is unknown), the limit in force when it is no preset, then a custom size.
 */
export function options(model?: number, current?: number, t: BuffI18n.T = BuffI18n.english, assumed = false): Option[] {
  const sizes = new Set(PRESETS.map((item) => item.tokens).filter((tokens) => !model || tokens <= model))
  if (current) sizes.add(current)
  const sorted = [...sizes].sort((a, b) => a - b)
  return [
    { id: "0", label: label(0, model, t, assumed), hint: hint(0, t, assumed) },
    ...sorted.map((tokens) => ({ id: String(tokens), label: label(tokens, model, t), hint: hint(tokens, t) })),
    { id: CUSTOM, label: `${t(OWN.label)}…`, hint: t(OWN.hint) },
  ]
}

/** An option id back as a limit in tokens; the custom id and anything else read as nothing. */
export function parse(id: string): number | undefined {
  if (!/^\d+$/.test(id)) return undefined
  return Number(id)
}

/** The limit in force: the model's window cut by the session's cap, whichever is known; a zero cap is none. */
export function effective(model: number | undefined, session: number | undefined): number | undefined {
  const cap = session || undefined
  if (model === undefined) return cap
  if (cap === undefined) return model
  return Math.min(model, cap)
}

/** A config entry as the helpers read it: a document with its keys, or anything else. */
export type ConfigLike = { type: string; info?: { context?: number } }

/** The cap the config's documents name for a new session, the last one winning; 0 and absence: none. */
export function configured(entries: readonly ConfigLike[] | undefined): number | undefined {
  const entry = entries?.findLast((item) => item.type === "document" && item.info?.context !== undefined)
  return entry?.info?.context || undefined
}

/** The smallest custom cap that makes sense. */
export const MIN_CUSTOM = 1_000

/** A typed custom size — "150000", "150 000", "150k", "1.5M" — as tokens within the model's window. */
export function parseCustom(text: string, max: number | undefined): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(text.replace(/\s+/g, ""))
  if (!match) return undefined
  const unit = match[2]?.toLowerCase()
  const value = Math.round(Number(match[1]) * (unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1))
  if (!Number.isInteger(value) || value < MIN_CUSTOM) return undefined
  if (max !== undefined && value > max) return undefined
  return value
}
