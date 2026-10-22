export * as BuffModelDefault from "./buff-model-default.js"

/**
 * Модель по умолчанию, когда человек ещё ничего не выбирал (#562) — одинаково в окне, в консоли
 * и в проверке модели. У агрегатора (OpenRouter) первая и самая новая запись каталога — часто
 * никому не известная модель; поэтому сначала модели известных разработчиков, умеющие вызывать
 * инструменты (без них агент не работает), затем самая новая, затем первая в списке.
 */
const VENDORS = ["anthropic", "openai", "google", "z-ai", "deepseek", "x-ai", "qwen", "moonshotai", "mistralai"]

export interface Candidate {
  readonly providerID: string
  readonly id: string
  /** Дата выпуска `YYYY-MM-DD`; пусто — неизвестна. */
  readonly released?: string
  readonly tools?: boolean
}

/** Разработчик модели: префикс идентификатора у агрегатора, иначе сам провайдер. */
const vendor = (model: Candidate) =>
  model.id.includes("/") ? model.id.slice(0, model.id.indexOf("/")) : model.providerID

const rank = (model: Candidate) => {
  const index = VENDORS.indexOf(vendor(model))
  return index === -1 ? VENDORS.length : index
}

export function pick<Model extends Candidate>(models: readonly Model[]): Model | undefined {
  return models
    .map((model, order) => ({ model, order }))
    .toSorted(
      (a, b) =>
        Number(b.model.tools !== false) - Number(a.model.tools !== false) ||
        rank(a.model) - rank(b.model) ||
        (b.model.released ?? "").localeCompare(a.model.released ?? "") ||
        a.order - b.order,
    )[0]?.model
}
