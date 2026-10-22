export * as BuffI18n from "./buff-i18n.js"

/**
 * Переводы Buff (#472) — для окна и консоли. Строка в коде пишется по-английски и проходит через
 * перевод; русский берётся из каталога «английский текст → русский» (как gettext). Так в файлах
 * апстрима правка — только обёртка вокруг уже написанной строки. Параметры — `{имя}`;
 * множественное число — формы через «|» (en: one|other, ru: one|few|many).
 */

import { RU } from "./buff-i18n/ru.js"

export type Locale = "ru" | "en"
export type Catalog = Readonly<Record<string, string>>
export type Params = Readonly<Record<string, string | number>>
/** Переводчик: схема собирает составные строки через него, экран передаёт свой (по языку). */
export type T = (text: string, params?: Params) => string
/** Множественное число через переводчика. */
export type N = (count: number, forms: string, params?: Params) => string

/** Язык, пока человек не выбрал свой: русский, как кабинет Buff. */
export const DEFAULT_LOCALE: Locale = "ru"

/** Язык из настройки; чужой или пустой — язык по умолчанию. */
export function locale(value: string | undefined): Locale {
  return value === "en" || value === "ru" ? value : DEFAULT_LOCALE
}

function fill(text: string, params?: Params): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/** Перевод по каталогу: английский — исходная строка, русский — из каталога (нет — исходная). */
export function translator(catalog: Catalog) {
  return (lang: Locale, text: string, params?: Params): string =>
    fill(lang === "ru" ? (catalog[text] ?? text) : text, params)
}

const RULES: Record<Locale, Intl.PluralRules> = {
  en: new Intl.PluralRules("en"),
  ru: new Intl.PluralRules("ru"),
}
const ORDER: Record<Locale, readonly Intl.LDMLPluralRule[]> = { en: ["one", "other"], ru: ["one", "few", "many"] }

/** Множественное число: `forms` — английские формы «one|other», русские — из каталога «one|few|many». */
export function plural(catalog: Catalog) {
  return (lang: Locale, count: number, forms: string, params?: Params): string => {
    const variants = (lang === "ru" ? (catalog[forms] ?? forms) : forms).split("|")
    const index = ORDER[lang].indexOf(RULES[lang].select(count))
    const form = variants[index] ?? variants[variants.length - 1]!
    return fill(form, { n: count, ...params })
  }
}

/** Английский без перевода — переводчик по умолчанию в функциях схемы. */
export const english: T = (text, params) => fill(text, params)
export const englishPlural: N = (count, forms, params) => plural({})("en", count, forms, params)

/** Перевод строк Buff по общему каталогу. */
export const t = translator(RU)
/** Множественное число строк Buff по общему каталогу. */
export const n = plural(RU)
