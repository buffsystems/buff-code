export * as BuffMcp from "./buff-mcp.js"

import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"
import { Mcp } from "./mcp.js"
import { define } from "./rpc.js"

/**
 * Управление MCP-серверами из интерфейса (#444): добавить, поправить, удалить — не открывая
 * файл конфигурации. Здесь всё, что одинаково для окна и консоли: области, имена, чтение
 * вставленного JSON, проверка, слова статуса. Хранит и пишет ядро (`core/src/buff/mcp.ts`).
 */

/** Где лежит сервер: у пользователя (все проекты) или в проекте (уезжает в его репозиторий). */
export const Scope = Schema.Literals(["user", "project"])
export type Scope = typeof Scope.Type

export const Entry = Schema.Struct({
  name: Schema.String,
  /** `builtin` — сервер самого Buff Code: виден, но не правится. */
  scope: Schema.Literals(["user", "project", "builtin"]),
  /** Файл, в котором сервер записан; у встроенных его нет. */
  file: Schema.optional(Schema.String),
  /** Запись как в файле: подстановки `{env:…}` не раскрыты, секреты не попадают в форму. */
  config: Schema.optional(Mcp.ServerConfig),
  status: Mcp.Status,
})
export type Entry = typeof Entry.Type

const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Reason = portable(Schema.Struct({}))
const Target = Schema.Struct({ scope: Scope, name: Schema.String })

export const Rpc = define({
  id: "buff.mcp",
  methods: {
    list: { input: Nothing, output: portable(Schema.Array(Entry)) },
    /** Записать сервер; `previous` — прежние область и имя, если его правят или переносят. */
    save: {
      input: portable(Schema.Struct({ ...Target.fields, config: Mcp.ServerConfig, previous: Schema.optional(Target) })),
      output: Nothing,
      errors: { invalid: Reason, unwritable: Reason },
    },
    remove: { input: portable(Target), output: Nothing, errors: { invalid: Reason, unwritable: Reason } },
    /** Включить или выключить насовсем: пишется в файл и переживает перезапуск. */
    enable: {
      input: portable(Schema.Struct({ ...Target.fields, enabled: Schema.Boolean })),
      output: Nothing,
      errors: { invalid: Reason, unwritable: Reason },
    },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})

/** Серверы самого Buff Code: их имена пользовательскому серверу не достаются. */
export const BUILTIN = ["buff", "knowledge", "repos"] as const

const BUILTIN_HINTS: Readonly<Record<(typeof BUILTIN)[number], string>> = {
  buff: "Company integrations and the administrator's MCP servers — through the connector",
  knowledge: "The organization's knowledge base: rules, decisions, how things are done",
  repos: "The project's repositories in the organization — read only",
}

/** Что даёт модели встроенный сервер Buff Code (#470); у своих серверов — ничего. */
export function builtinHint(name: string, t: BuffI18n.T = BuffI18n.english): string | undefined {
  const hint = (BUILTIN_HINTS as Record<string, string | undefined>)[name]
  return hint === undefined ? undefined : t(hint)
}

const BUILTIN_TITLES: Readonly<Record<(typeof BUILTIN)[number], string>> = {
  buff: "Company integrations",
  knowledge: "Knowledge base",
  repos: "Project repositories",
}

/** Заголовок запроса MCP-сервера к человеку (#470): встроенный сервер — словами, свой — по имени. */
export function requestTitle(server: string, t: BuffI18n.T = BuffI18n.english): string {
  const title = (BUILTIN_TITLES as Record<string, string | undefined>)[server]
  return t("Request from «{server}»", { server: title === undefined ? server : t(title) })
}

/** Сообщение сервера — простой текст с разметкой: одиночный перенос строки в нём — перенос, а не пробел. */
export function messageMarkdown(message: string): string {
  return message.replace(/([^\n])\n(?=[^\n])/g, "$1  \n")
}

export function nameProblem(name: string, t: BuffI18n.T = BuffI18n.english): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return t("The name is Latin letters, digits, hyphen and underscore, no spaces.")
  if ((BUILTIN as readonly string[]).includes(name))
    return t("The name «{name}» is taken by a built-in Buff server — choose another.", { name })
  return undefined
}

type Config = Mcp.ServerConfig

export function configProblem(config: Config, t: BuffI18n.T = BuffI18n.english): string | undefined {
  if (config.type === "local")
    return config.command.some((part) => part.trim()) ? undefined : t("Enter the command that starts the server.")
  return /^https?:\/\/\S+$/.test(config.url) ? undefined : t("The server address must start with http:// or https://.")
}

// --- вставленный JSON -----------------------------------------------------------------------

/** JSON с комментариями и висячими запятыми — так его обычно и вставляют из чужих настроек. */
function relaxed(text: string): unknown {
  let out = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      out += char
      if (char === "\\") out += text[++i] ?? ""
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
      continue
    }
    if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end === -1 ? text.length : end + 1
      continue
    }
    out += char
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const strings = (value: unknown): Record<string, string> | undefined => {
  if (!record(value)) return undefined
  const kept = Object.entries(value).flatMap(([key, item]) =>
    typeof item === "string" || typeof item === "number" ? [[key, String(item)] as const] : [],
  )
  return kept.length ? Object.fromEntries(kept) : undefined
}

/** Одна запись сервера: наш формат как есть, чужой (command/args/env, url/headers) — в наш. */
function oneServer(value: Record<string, unknown>): Config | undefined {
  const type = typeof value.type === "string" ? value.type : undefined
  if (type === "local" && Array.isArray(value.command)) return value as unknown as Config
  if (type === "remote" && typeof value.url === "string") return value as unknown as Config
  if (typeof value.url === "string") {
    const headers = strings(value.headers)
    return { type: "remote", url: value.url, ...(headers ? { headers } : {}) } as Config
  }
  const command =
    typeof value.command === "string"
      ? [value.command, ...(Array.isArray(value.args) ? value.args.map(String) : [])]
      : Array.isArray(value.command)
        ? value.command.map(String)
        : undefined
  if (!command) return undefined
  const environment = strings(value.env ?? value.environment)
  return { type: "local", command, ...(environment ? { environment } : {}) } as Config
}

export type FromJson =
  | { readonly servers: readonly { readonly name?: string; readonly config: Config }[] }
  | { readonly problem: string }

/**
 * Что вставили во вкладку JSON: запись одного сервера либо целый блок `mcpServers` — так
 * серверы описывают другие агенты, и переносить их удобно целиком.
 */
export function fromJson(text: string, t: BuffI18n.T = BuffI18n.english): FromJson {
  let parsed: unknown
  try {
    parsed = relaxed(text)
  } catch {
    return { problem: t("This is not JSON: check the brackets and quotes.") }
  }
  if (!record(parsed)) return { problem: t("Expected an object describing the server.") }
  const NO_SERVER = t("The description has neither a command (command) nor an address (url).")
  if (record(parsed.mcpServers)) {
    const servers = Object.entries(parsed.mcpServers).flatMap(([name, value]) => {
      const config = record(value) ? oneServer(value) : undefined
      return config ? [{ name, config }] : []
    })
    return servers.length ? { servers } : { problem: t("The mcpServers block has no servers.") }
  }
  const config = oneServer(parsed)
  return config ? { servers: [{ config }] } : { problem: NO_SERVER }
}

// --- статус ---------------------------------------------------------------------------------

export interface StatusText {
  readonly tone: "ok" | "busy" | "off" | "warn" | "fail"
  readonly label: string
  /** Причина словами, по которым понятно, что проверить. */
  readonly reason?: string
  /** Ошибка как пришла — для «Подробности». */
  readonly details?: string
}

const FAILURES: readonly (readonly [RegExp, string])[] = [
  [/ENOENT|NotFound|not found/i, "Command not found. Check that the program is installed and the path is right."],
  [/EACCES|permission denied/i, "No permission to run the command. Check the file permissions."],
  [/Connection closed/i, "The server closed the connection right after starting. Check the command and its arguments."],
  [
    /fetch failed|Unable to connect|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|network/i,
    "The server at this address does not respond. Check the address and the network.",
  ],
  [/timed? ?out|timeout/i, "The server did not answer in time. Check that it starts, or increase the timeout."],
  [/Invalid MCP URL/i, "The server address is written incorrectly."],
  [/401|403|unauthori[sz]ed|forbidden/i, "The server denied access. Check the key or headers."],
]

/** Статус сервера — одними словами везде, где он показан (#444: раньше в трёх местах по-разному). */
export function statusText(status: Mcp.Status, t: BuffI18n.T = BuffI18n.english): StatusText {
  switch (status.status) {
    case "connected":
      return { tone: "ok", label: t("Connected") }
    case "pending":
      return { tone: "busy", label: t("Connecting…") }
    case "disabled":
      return { tone: "off", label: t("Disabled") }
    case "needs_auth":
      return { tone: "warn", label: t("Sign-in needed"), reason: status.error }
    case "failed": {
      const known = FAILURES.find(([pattern]) => pattern.test(status.error))
      return {
        tone: "fail",
        label: t("Did not start"),
        reason: known ? t(known[1]) : status.error,
        details: status.error,
      }
    }
  }
}

// --- строки формы ---------------------------------------------------------------------------

const pairLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

/** Строки `ИМЯ=значение` (переменные окружения, заголовки) → запись. */
export function pairs(text: string): Record<string, string> {
  return Object.fromEntries(
    pairLines(text).flatMap((line) => {
      const at = line.indexOf("=")
      return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()] as const] : []
    }),
  )
}

export function pairsProblem(text: string, t: BuffI18n.T = BuffI18n.english): string | undefined {
  const bad = pairLines(text).find((line) => line.indexOf("=") < 1)
  return bad === undefined ? undefined : t("The line «{line}» is not in the form NAME=value.", { line: bad })
}

export function lines(values: Record<string, string> | undefined): string {
  return Object.entries(values ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

/** Строка команды → программа и аргументы; кавычки держат аргумент с пробелами вместе. */
export function command(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3])
}

export function commandLine(parts: readonly string[]): string {
  return parts.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ")
}
