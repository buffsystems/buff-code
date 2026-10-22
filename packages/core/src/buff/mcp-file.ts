export * as BuffMcpFile from "./mcp-file.js"

import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { BuffLocale } from "./locale.js"

/**
 * MCP-серверы в файле конфигурации (#444): текст на входе, текст на выходе. Правится только
 * нужная запись — комментарии и остальные настройки остаются как были. Записи читаются как
 * написаны: подстановки `{env:…}` не раскрыты, поэтому секрет из окружения не уедет в файл
 * при сохранении формы.
 */
const FORMAT = { formattingOptions: { tabSize: 2, insertSpaces: true } }
const BROKEN = "The configuration file cannot be read: it has a markup error. Fix it by hand."

type Raw = Record<string, unknown>
const record = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value)
/** Запись сервера, а не настройка секции (`timeout`, `servers`). */
const server = (value: unknown): value is Raw => record(value) && typeof value.type === "string"

function document(text: string): Raw {
  if (!text.trim()) return {}
  const errors: ParseError[] = []
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !record(parsed)) throw new Error(BuffLocale.t(BROKEN))
  return parsed
}

/** Прежняя раскладка: сервер лежал прямо под `mcp`, без `servers`. */
function legacy(mcp: Raw): Raw {
  return Object.fromEntries(Object.entries(mcp).filter(([key, value]) => key !== "servers" && server(value)))
}

export function servers(text: string): Raw {
  const mcp = document(text).mcp
  if (!record(mcp)) return {}
  return { ...legacy(mcp), ...(record(mcp.servers) ? mcp.servers : {}) }
}

const edit = (text: string, path: (string | number)[], value: unknown) =>
  applyEdits(text, modify(text, path, value, FORMAT))

/** Записать сервер (`undefined` — убрать). Сервер из прежней раскладки переезжает в нынешнюю. */
export function withServer(text: string, name: string, config: unknown): string {
  const mcp = document(text).mcp
  const base = text.trim() ? text : "{}\n"
  const moved = record(mcp) && name in legacy(mcp) ? edit(base, ["mcp", name], undefined) : base
  // Убирать нечего — правка не нужна: парсер отказывается удалять по пути, которого нет.
  const absent = config === undefined && !(record(mcp) && record(mcp.servers) && name in mcp.servers)
  const next = absent ? moved : edit(moved, ["mcp", "servers", name], config)
  return next.endsWith("\n") ? next : `${next}\n`
}

/** Включить или выключить сервер: пишется только признак, остальная запись не трогается. */
export function withEnabled(text: string, name: string, enabled: boolean): string {
  const current = servers(text)[name]
  if (!record(current)) return text
  const { disabled: _, ...rest } = current
  return withServer(text, name, enabled ? rest : { ...rest, disabled: true })
}
