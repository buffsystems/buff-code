export * as BuffCustomList from "./custom-list.js"

import type { BuffCustom } from "@opencode/schema/buff-custom"

/**
 * Список команд или субагентов для настроек (#446): свои файлы с диска, записи реестра ядра
 * и выключенные складываются в одну картину. Без ввода-вывода — проверяется напрямую.
 */

export interface Own {
  readonly id: string
  readonly scope: BuffCustom.Scope
  readonly file: string
  readonly values: Readonly<Record<string, string>>
}

/** Запись реестра ядра (включая выключенные — они убраны из реестра, но в списке остаются). */
export interface Registered {
  readonly id: string
  readonly description?: string
  readonly values?: Readonly<Record<string, string>>
}

export function entries(input: {
  /** Свои файлы, от слабого к сильному: файл проекта перекрывает файл пользователя. */
  readonly own: readonly Own[]
  readonly registered: readonly Registered[]
  readonly disabled: ReadonlySet<string>
  /** Имена, заданные ключом файла настроек. */
  readonly configured: ReadonlySet<string>
  /** Записи, которым нужно подтверждение человека: есть ли оно. */
  readonly trust?: ReadonlyMap<string, boolean>
}): BuffCustom.Entry[] {
  const found = new Map<string, BuffCustom.Entry>()
  // Свои записи — с диска: файл уже записан, а ядро могло его ещё не перечитать.
  for (const item of input.own)
    found.set(item.id, {
      id: item.id,
      ...(item.values.description ? { description: item.values.description } : {}),
      scope: item.scope,
      path: item.file,
      enabled: !input.disabled.has(item.id),
      values: { ...item.values },
    })
  for (const item of input.registered) {
    if (found.has(item.id)) continue
    found.set(item.id, {
      id: item.id,
      ...(item.description ? { description: item.description } : {}),
      scope: input.configured.has(item.id) ? "config" : "builtin",
      enabled: !input.disabled.has(item.id),
      values: { ...item.values },
    })
  }
  return [...found.values()]
    .map((entry) => {
      const trusted = input.trust?.get(entry.id)
      return trusted === undefined ? entry : { ...entry, trusted }
    })
    .toSorted((a, b) => a.id.localeCompare(b.id))
}
