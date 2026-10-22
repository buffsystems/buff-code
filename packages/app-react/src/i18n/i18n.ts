// Translations of the React window (#584): the Solid window's dictionaries (app + ui, branded,
// with Buff's Russian fixes) behind a framework-free translator, plus Buff's own catalog
// (BuffI18n). Only the locales Buff Code offers are loaded.

import { brandDictionary } from "@opencode/app/react-reuse/brand"
import { DEFAULT_LOCALE, offeredLocale, type OfferedLocale } from "@opencode/app/react-reuse/locales"
import { dict as appEnglish } from "@opencode/app/i18n/en"
import { dict as uiEnglish } from "@opencode/ui/i18n/en"
import { BuffI18n } from "@opencode/schema/buff-i18n"

export type Locale = OfferedLocale
export type Params = Record<string, string | number | boolean>
export type Dictionary = Readonly<Record<string, string>>
export type TranslationKey = Extract<keyof typeof appEnglish | keyof typeof uiEnglish, string>

export { DEFAULT_LOCALE }

export const english: Dictionary = brandDictionary({ ...appEnglish, ...uiEnglish })

const intl: Record<Locale, string> = { en: "en", ru: "ru" }

export async function loadDictionary(locale: Locale): Promise<Dictionary> {
  if (locale === "en") return english
  const [app, ui, upstream] = await Promise.all([
    import("@opencode/app/i18n/ru"),
    import("@opencode/ui/i18n/ru"),
    import("@opencode/app/react-reuse/ru-upstream"),
  ])
  // Buff (#472): gaps of upstream's Russian dictionary are filled on top, upstream files stay as is.
  return {
    ...english,
    ...brandDictionary({ ...app.dict, ...ui.dict }),
    ...brandDictionary(upstream.RU_UPSTREAM),
    ...brandDictionary(upstream.RU_UPSTREAM_FIXES),
  }
}

/** A stored or detected language, narrowed to the offered ones. */
export function normalizeLocale(value: string | undefined) {
  return value ? offeredLocale(value) : DEFAULT_LOCALE
}

export function createTranslator(locale: Locale, dictionary: Dictionary) {
  const rules = new Intl.PluralRules(intl[locale])
  const buff = BuffI18n.locale(locale)
  const t = (key: TranslationKey, params?: Params) => fill(dictionary[key] ?? english[key] ?? key, params)
  return {
    locale,
    intl: intl[locale],
    t,
    /** `${key}.${category}` by the locale's plural rules, falling back to `${key}.other`. */
    plural(key: string, count: number, params?: Params) {
      const text = dictionary[`${key}.${rules.select(count)}`] ?? dictionary[`${key}.other`] ?? `${key}.other`
      return fill(text, { ...params, count })
    },
    /** Buff's own strings: English in code, Russian from the shared catalog. */
    buff: {
      t: (text: string, params?: BuffI18n.Params) => BuffI18n.t(buff, text, params),
      n: (count: number, forms: string, params?: BuffI18n.Params) => BuffI18n.n(buff, count, forms, params),
    },
  }
}

export type Translator = ReturnType<typeof createTranslator>

// Same as the Solid window's resolveTemplate: every `{{ name }}` gets its parameter.
function fill(text: string, params?: Params) {
  if (!params) return text
  return Object.entries(params).reduce(
    (current, [key, value]) => current.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), String(value)),
    text,
  )
}
