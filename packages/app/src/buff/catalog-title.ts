import { BuffI18n } from "@opencode/schema/buff-i18n"
import { RU } from "@opencode/schema/buff-i18n/ru"
import { dict as appEn } from "@/runtime/i18n/en"
import { dict as appRu } from "@/runtime/i18n/ru"
import { dict as uiEn } from "@opencode/ui/i18n/en"
import { dict as uiRu } from "@opencode/ui/i18n/ru"
import { RU_UPSTREAM } from "./i18n/ru-upstream"

/**
 * Заголовок команды из сохранённого каталога (#472). Каталог запоминает команды других экранов
 * с тем заголовком, что был при регистрации, — на тогдашнем языке. Узнаём строку по словарям
 * (апстрима и Buff) и показываем на текущем языке; незнакомую — как есть.
 */

const english: Record<string, string> = { ...uiEn, ...appEn }
const russian: Record<string, string> = { ...uiRu, ...appRu, ...RU_UPSTREAM }

let keys: Map<string, string> | undefined
/** Текст на любом из языков → ключ словаря апстрима (первый найденный). */
function upstreamKey(title: string): string | undefined {
  keys ??= new Map([...Object.entries(english), ...Object.entries(russian)].reverse().map(([key, text]) => [text, key]))
  return keys.get(title)
}

let sources: Map<string, string> | undefined
/** Русский текст Buff → его английская строка. */
function buffSource(title: string): string | undefined {
  sources ??= new Map(Object.entries(RU).map(([source, text]) => [text, source]))
  return title in RU ? title : sources.get(title)
}

export function catalogTitle(title: string, locale: string): string {
  const key = upstreamKey(title)
  if (key) return (BuffI18n.locale(locale) === "ru" ? russian[key] : english[key]) ?? title
  const source = buffSource(title)
  return source ? BuffI18n.t(BuffI18n.locale(locale), source) : title
}
