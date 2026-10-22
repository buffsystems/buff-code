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

/** Язык, пока человек не выбрал свой (#471): русский при любом языке системы, как кабинет Buff. */
export const DEFAULT_LOCALE: OfferedLocale = "ru"
