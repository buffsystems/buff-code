// Настройки → Модели → «Режимы по умолчанию» (#836, эпик #783): дефолтный режим размышлений
// и потолок контекста новой сессии — ключи `thinking` и `context` глобального конфига сервера.
// Экран читает их отсюда и пишет через config.update.

import type { ConfigEntry } from "@opencode/client/promise"

export type DefaultModes = { thinking: string; context: number }

/** The defaults the global documents name: the default level and the whole window when none does. */
export function defaultModes(entries: readonly ConfigEntry[]): DefaultModes {
  // Only the global documents count: the first directory entry starts the project's own config.
  const boundary = entries.findIndex((entry) => entry.type === "directory")
  const global = boundary === -1 ? entries : entries.slice(0, boundary)
  const documents = global.flatMap((entry) => (entry.type === "document" ? [entry.info] : []))
  const thinking = documents.findLast((info) => info.thinking !== undefined)?.thinking
  const context = documents.findLast((info) => info.context !== undefined)?.context
  return { thinking: thinking || "default", context: context || 0 }
}
