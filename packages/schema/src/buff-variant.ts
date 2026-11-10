export * as BuffVariant from "./buff-variant.js"

import { BuffI18n } from "./buff-i18n.js"

/**
 * Режим размышлений (#759) — вариант модели: сколько она думает перед ответом (reasoning effort,
 * бюджет мышления; что именно уходит провайдеру — core/variant.ts). Здесь слова для людей: подпись
 * и пояснение к каждому известному id. Подписи — английские исходные строки; переводит экран.
 */

export const TITLE = "Thinking mode"

/** The levels a settings control offers (#836): the shared vocabulary, the default first. */
export const LEVELS = ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"] as const

const WORDS: Record<string, { label: string; hint: string }> = {
  default: { label: "Default", hint: "As the model and its provider are set up" },
  none: { label: "Off", hint: "Answers without thinking: the fastest" },
  minimal: { label: "Minimal", hint: "Barely thinks: quick answers" },
  low: { label: "Low", hint: "Thinks briefly: faster and cheaper" },
  medium: { label: "Medium", hint: "Thinks moderately: a balance of speed and quality" },
  high: { label: "High", hint: "Thinks longer: better on hard tasks, slower" },
  xhigh: { label: "Very high", hint: "Thinks even longer: for very hard tasks" },
  max: { label: "Maximum", hint: "Thinks as long as it can: the slowest and costliest" },
  thinking: { label: "On", hint: "Thinks before answering" },
}

/** The variant's label; an unknown id shows as it is. */
export function label(id: string, t: BuffI18n.T = BuffI18n.english): string {
  const words = WORDS[id]
  return words ? t(words.label) : id
}

/** What the variant changes, in a line; none for an unknown id. */
export function hint(id: string, t: BuffI18n.T = BuffI18n.english): string {
  const words = WORDS[id]
  return words ? t(words.hint) : ""
}
