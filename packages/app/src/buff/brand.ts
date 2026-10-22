/**
 * Имя продукта в интерфейсе десктопа (#398). Переводы приходят от апстрима — в каждом из ~50
 * языков десятки строк с «OpenCode». Править их по файлам — конфликт при каждом подъёме
 * апстрима, поэтому имя подставляется при загрузке словаря. Уведомление о товарном знаке
 * говорит об OpenCode, а не о нас, и остаётся как есть.
 */

const KEEP: ReadonlySet<string> = new Set(["settings.about.trademark"])

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/OpenCode Desktop/g, "Buff Code"],
  [/\ban OpenCode\b/g, "a Buff Code"],
  [/OpenCode/g, "Buff Code"],
  [/\bopencode pair\b/g, "buff pair"],
]

export function brandDictionary<T extends Record<string, string>>(dict: T): T {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(dict))
    out[key] =
      KEEP.has(key) || typeof value !== "string"
        ? value
        : RULES.reduce((text, [pattern, name]) => text.replace(pattern, name), value)
  return out as T
}

/** В Buff Code — только модели организации (#377): «свой OpenAI-совместимый провайдер»
 *  в окне подключения не предлагается. Список провайдеров ядро уже сузило до Buff. */
export const OFFER_CUSTOM_PROVIDER = false
