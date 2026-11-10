export * as BuffModelPrefs from "./buff-model-prefs.js"

import { Schema } from "effect"
import { define } from "./rpc.js"

/**
 * Какие модели предлагают списки выбора (#743): сначала отметка человека в «Управлении моделями»
 * («показывать» / «скрыть»); без отметки — новейшая модель каждого семейства у провайдера,
 * вышедшая за последние полгода, и модели без читаемой даты выпуска. Отметки хранит окно (#584)
 * и передаёт их службе машины, чтобы редактор команд и субагентов и телефон (`models.list`)
 * предлагали тот же набор, что композер окна.
 */

export const Visibility = Schema.Literals(["show", "hide"])
export type Visibility = typeof Visibility.Type

export const Choice = Schema.Struct({ providerID: Schema.String, modelID: Schema.String, visibility: Visibility })
export type Choice = typeof Choice.Type

/** Отметки окна как они есть; служба хранит последний присланный список. */
export const Prefs = Schema.Struct({ user: Schema.Array(Choice) })
export type Prefs = typeof Prefs.Type

const portable = Schema.toStandardSchemaV1

export const Rpc = define({
  id: "buff.model-prefs",
  methods: {
    prefs: { input: portable(Schema.Struct({})), output: portable(Prefs) },
    setPrefs: { input: portable(Prefs), output: portable(Schema.Undefined) },
  },
  events: {},
})

export interface Candidate {
  readonly providerID: string
  readonly modelID: string
  readonly family?: string | undefined
  /** Дата выпуска, мс эпохи; нет, не число или 0 — дата неизвестна. */
  readonly released?: number | undefined
}

export const key = (model: { providerID: string; modelID: string }) => `${model.providerID}:${model.modelID}`

// Как в окне: полгода средними месяцами, а не календарными.
const SIX_MONTHS = 6 * 30.436875 * 24 * 60 * 60 * 1000

// 0 и меньше — дата неизвестна (#763): схема пишет released: 0 моделям без даты, например своего провайдера.
const dated = (model: Candidate) =>
  typeof model.released === "number" && Number.isFinite(model.released) && model.released > 0

/** Новейшая модель каждого семейства у провайдера, вышедшая за полгода: видна без отметки. */
export function latest(models: readonly Candidate[], now: number): Set<string> {
  const families = new Map<string, Candidate>()
  for (const model of models) {
    if (!dated(model) || !(Math.abs(now - model.released!) < SIX_MONTHS)) continue
    const family = `${model.providerID}\u0000${model.family ?? ""}`
    const current = families.get(family)
    if (!current || model.released! > current.released!) families.set(family, model)
  }
  return new Set([...families.values()].map(key))
}

/** Видна ли модель: отметка человека, иначе новейшая в семействе или без даты. */
export function visible(model: Candidate, choice: Visibility | undefined, newest: ReadonlySet<string>): boolean {
  if (choice === "hide") return false
  if (choice === "show") return true
  if (newest.has(key(model))) return true
  return !dated(model)
}

/** Модели, которые предлагает список, в исходном порядке. */
export function filter<M extends Candidate>(models: readonly M[], choices: readonly Choice[], now = Date.now()): M[] {
  const chosen = new Map(choices.map((choice) => [key(choice), choice.visibility]))
  const newest = latest(models, now)
  return models.filter((model) => visible(model, chosen.get(key(model)), newest))
}
