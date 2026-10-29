import { BuffI18n } from "@opencode/schema/buff-i18n"

/**
 * Языки, которые предлагает Buff Code (#469): английский и русский. Переводы апстрима остаются
 * в репозитории как есть — править или удалять их значит получать конфликт на каждом подъёме,
 * поэтому список сужается здесь. Язык, сохранённый раньше и больше не предлагаемый, читается
 * как английский: часть словарей апстрима неполна, и окно с ними не поднимается.
 */
export const OFFERED_LOCALES = ["en", "ru"] as const

export type OfferedLocale = (typeof OFFERED_LOCALES)[number]

export function offeredLocale(value: string): OfferedLocale {
  return OFFERED_LOCALES.find((locale) => locale === value) ?? "en"
}

/** Язык, если система не говорит ни по-русски, ни по-английски (#713). */
export const DEFAULT_LOCALE: OfferedLocale = "ru"

/**
 * Язык, пока человек не выбрал свой (#713): первый русский или английский из языков системы
 * (браузера, а в приложении — ОС), иначе русский. Правило общее для всех клиентов Buff.
 */
export function systemLocale(
  languages: readonly (string | undefined)[] = typeof navigator === "undefined"
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
): OfferedLocale {
  return BuffI18n.systemLocale(languages)
}
