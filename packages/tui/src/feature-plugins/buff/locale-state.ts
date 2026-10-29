import { BuffI18n } from "@opencode/schema/buff-i18n"
import { createSignal } from "solid-js"

/**
 * Язык процесса (#472): один на консоль, режим mini и разовые команды cli. Пока служба его не
 * сообщила — язык системы (#713: LANGUAGE, LC_*, LANG; не русский и не английский — русский),
 * как у ядра: разовая команда, которая службу не спрашивает, говорит на языке системы целиком.
 * Строки пишутся по-английски и идут через `t`/`n`, русский — из каталога.
 */

const [locale, setLocale] = createSignal<BuffI18n.Locale>(BuffI18n.systemLocale(BuffI18n.envLanguages(process.env)))

export const t = (text: string, params?: BuffI18n.Params) => BuffI18n.t(locale(), text, params)
export const n = (count: number, forms: string, params?: BuffI18n.Params) => BuffI18n.n(locale(), count, forms, params)

/** Принять язык, сообщённый службой. */
export function adoptLocale(next: BuffI18n.Locale): void {
  setLocale(next)
}

export const currentLocale = (): BuffI18n.Locale => locale()

/** Языковой тег для чисел и дат (Intl) — по языку человека. */
export const localeTag = (): string => (locale() === "ru" ? "ru-RU" : "en-US")
