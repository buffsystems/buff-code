export * as BuffNames from "./buff-names.js"

/**
 * Имена файлов и каталогов Buff Code на диске (#510). Свои имена — buffcode; апстримные
 * (opencode) читаются и дальше, чтобы у проектов и машин, где они уже есть, ничего не сломалось.
 */

/** Файлы конфигурации в порядке загрузки: следующий перекрывает предыдущий, свои — последними. */
export const CONFIG_FILES = ["opencode.json", "opencode.jsonc", "buffcode.json", "buffcode.jsonc"] as const

/** Новый файл конфигурации: у пользователя — .jsonc, в проекте — .json (как у апстрима). */
export const USER_CONFIG_FILE = "buffcode.jsonc"
export const PROJECT_CONFIG_FILE = "buffcode.json"

/** Каталог Buff Code в проекте (и в домашнем каталоге — для планов). */
export const DIR = ".buffcode"
export const LEGACY_DIR = ".opencode"

/**
 * Каталоги проекта в порядке обхода одного уровня: списки потом разворачиваются, так что
 * свой каталог оказывается последним и перекрывает апстримный.
 */
export const PROJECT_DIRS = [DIR, LEGACY_DIR] as const

/** Это каталог Buff Code в проекте — свой или апстримный. */
export function isProjectDir(name: string): boolean {
  return name === DIR || name === LEGACY_DIR
}

/**
 * Куда писать: в свой каталог, если он есть; в апстримный, если есть только он (настройки
 * проекта не разъезжаются по двум местам); на чистом месте — в свой.
 */
export function pick(own: string, legacy: string, isDir: (path: string) => boolean): string {
  if (isDir(own)) return own
  return isDir(legacy) ? legacy : own
}
