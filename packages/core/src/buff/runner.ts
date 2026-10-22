export * as BuffRunnerMode from "./runner.js"

import { BuffRunner } from "@opencode/schema/buff-runner"

/**
 * Режим раннера (#439) — включён, когда процесс запущен с контекстом прогона в окружении.
 * Читается при обращении и запоминается по значению переменной: у процесса раннера оно не
 * меняется, а встраивающий процесс (SDK) может задать его до создания экземпляра. Испорченный
 * контекст — ошибка при первом же чтении, а не молчаливый режим разработчика.
 */
let cached: { readonly raw: string | undefined; readonly context: BuffRunner.Context | null } | undefined

function current(): BuffRunner.Context | null {
  const raw = process.env[BuffRunner.ENV]
  if (!cached || cached.raw !== raw) cached = { raw, context: BuffRunner.parse(process.env) }
  return cached.context
}

// Раннер узнаёт об испорченном контексте сразу при запуске.
current()

/** Контекст прогона; null — режим разработчика. */
export function context(): BuffRunner.Context | null {
  return current()
}

export function active(): boolean {
  return current() !== null
}

/** Приёмник сквозной записи раннера: адрес и заголовки — контекст прогона плюс пропуск
 *  флота. null — приёмник не задан, записи остаются только в базе на диске. */
export function sink(): { url: string; headers: Record<string, string> } | null {
  const parsed = current()
  if (!parsed?.sink) return null
  return { url: parsed.sink.url, headers: { ...BuffRunner.headers(parsed), "X-Service-Token": parsed.sink.token } }
}
