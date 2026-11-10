export * as BuffSecret from "./buff-secret.js"

import { ascending } from "./identifier.js"

/**
 * Секреты человека (#765): пароль, ключ, токен из секретного поля формы. Значение живёт в
 * хранилище Buff Code; модель, транскрипт и файлы конфигурации видят только ссылку
 * `secret:<id>`, а настройки подключений — подстановку `{secret:<id>}`, которую Buff Code
 * раскрывает в момент запуска подключения. Здесь — форма ссылок, одна для ядра и экранов.
 */

export const PREFIX = "secret:"
export const MASK = "••••••••"

/** Префикс ключа значения в хранилище Buff Code: такие строки не покидают машину (сквозная запись их не дублирует). */
export const STORE_PREFIX = "buff.secret:"

export function createID(): string {
  return "sec_" + ascending()
}

/** Ссылка, которую получает модель вместо значения. */
export function ref(id: string): string {
  return PREFIX + id
}

export function isRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX) && value.length > PREFIX.length
}

export function idOf(reference: string): string {
  return reference.slice(PREFIX.length)
}

/** Подстановка для настроек подключения: `{secret:<id>}` в переменной, заголовке или аргументе. */
export function token(id: string): string {
  return `{secret:${id}}`
}

const TOKEN = /\{secret:([^}]+)\}/g

/** Идентификаторы всех подстановок в тексте. */
export function tokensIn(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((match) => match[1]!)
}

/** Раскрыть подстановки; неизвестный идентификатор — ошибкой, не пустой строкой. */
export function expand(text: string, lookup: (id: string) => string | undefined): string | { missing: string } {
  const missing = tokensIn(text).find((id) => lookup(id) === undefined)
  if (missing !== undefined) return { missing }
  return text.replace(TOKEN, (_, id: string) => lookup(id)!)
}
