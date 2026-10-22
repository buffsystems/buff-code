import path from "node:path"
import { existsSync } from "node:fs"
import { OPENCODE_CHANNEL } from "./version"

export function databasePath(data: string, exists: (file: string) => boolean = existsSync) {
  const explicit = process.env.OPENCODE_DB
  if (explicit) return explicit === ":memory:" ? explicit : path.resolve(data, explicit)
  const suffix =
    ["latest", "dev", "beta", "next", "prod"].includes(OPENCODE_CHANNEL) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
      ? ""
      : `-${OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}`
  // Buff (#510): своя база — buffcode.db. Уже существующая апстримная (opencode.db) остаётся
  // в работе, пока своей нет: переносить живую базу с её WAL небезопасно, а история сессий
  // разработчика должна остаться на месте.
  const own = path.resolve(data, `buffcode${suffix}.db`)
  const legacy = path.resolve(data, `opencode${suffix}.db`)
  return !exists(own) && exists(legacy) ? legacy : own
}
