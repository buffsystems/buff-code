export * as BuffWorkflowFile from "./buff-workflow-file.js"

import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Файл сценария (#448) — валидный TypeScript, как в ZCode: в начале блок метаданных
 * `/* buff-workflow … *\/` (JSON: имя, описание, когда применять, аргументы), затем скрипт как
 * есть. Здесь — чтение и запись файла и проверка аргументов, одинаковые для окна, консоли и ядра.
 */

export const ArgType = Schema.Literals(["string", "number", "boolean", "json"])
export type ArgType = typeof ArgType.Type

export const ArgDecl = Schema.Struct({
  type: ArgType,
  description: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
  default: Schema.optional(Schema.Unknown),
})
export type ArgDecl = typeof ArgDecl.Type

export const Meta = Schema.Struct({
  /** Имя файла и вызова — латиницей. */
  name: Schema.String,
  /** Название для человека, на его языке (#470); без него показывается имя. */
  title: Schema.optional(Schema.String),
  description: Schema.String,
  whenToUse: Schema.optional(Schema.String),
  args: Schema.Record(Schema.String, ArgDecl),
})
export type Meta = typeof Meta.Type

/** Как сценарий называется в окне и консоли. */
export function displayName(meta: Meta): string {
  return meta.title?.trim() || meta.name
}

export const EXTENSION = ".dwf.ts"
const OPEN = "/* buff-workflow\n"
const CLOSE = "\n*/\n"
const NAME = /^[A-Za-z0-9._-]+$/

export function nameProblem(name: string): string | undefined {
  return NAME.test(name) && !/^\.+$/.test(name)
    ? undefined
    : "A name is Latin letters, digits, dot, dash and underscore."
}

export function serialize(meta: Meta, script: string): string {
  return `${OPEN}${JSON.stringify(meta, null, 2)}${CLOSE}${script}`
}

export type Parsed = { readonly meta: Meta; readonly script: string } | { readonly problem: string }

const decodeMeta = Schema.decodeUnknownOption(Meta)

export function parse(text: string): Parsed {
  if (!text.startsWith(OPEN)) return { problem: "No /* buff-workflow … */ metadata block at the start of the file." }
  const end = text.indexOf(CLOSE, OPEN.length)
  if (end < 0) return { problem: "The metadata block is not closed." }
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(OPEN.length, end))
  } catch {
    return { problem: "The metadata at the start of the file is not valid JSON." }
  }
  if (typeof raw !== "object" || raw === null)
    return { problem: "The metadata at the start of the file is not valid JSON." }
  const record = raw as Record<string, unknown>
  if (typeof record.description !== "string" || !record.description.trim())
    return { problem: "The workflow has no description." }
  const meta = decodeMeta({ args: {}, ...record })
  if (meta._tag === "None") return { problem: "The workflow metadata does not match the format." }
  return { meta: meta.value, script: text.slice(end + CLOSE.length) }
}

const WRONG: Record<ArgType, string> = {
  string: "Must be a string.",
  number: "Must be a number.",
  boolean: "Must be yes or no.",
  json: "Not valid JSON.",
}

function fits(type: ArgType, value: unknown): boolean {
  if (type === "string") return typeof value === "string"
  if (type === "number") return typeof value === "number" && Number.isFinite(value)
  if (type === "boolean") return typeof value === "boolean"
  return true
}

export type Checked =
  | { readonly values: Readonly<Record<string, unknown>> }
  | { readonly problems: Readonly<Record<string, string>> }

/** Значения запуска против объявлений: умолчания подставлены, всё проверено — или что не так. */
export function checkArgs(decls: Meta["args"], given: Readonly<Record<string, unknown>>): Checked {
  const problems: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  for (const name of Object.keys(given)) if (!(name in decls)) problems[name] = "The workflow has no such argument."
  for (const [name, decl] of Object.entries(decls)) {
    const value = name in given ? given[name] : decl.default
    if (value === undefined) {
      if (decl.required) problems[name] = "Required argument."
      continue
    }
    if (!fits(decl.type, value)) problems[name] = WRONG[decl.type]
    else values[name] = value
  }
  return Object.keys(problems).length ? { problems } : { values }
}

/** Текст из поля формы → значение аргумента; пустое — не задано. */
export function fromText(
  decl: Pick<ArgDecl, "type">,
  text: string,
): { readonly value?: unknown; readonly problem?: string } {
  const trimmed = text.trim()
  if (decl.type === "string") return text === "" ? {} : { value: text }
  if (trimmed === "") return {}
  if (decl.type === "number")
    return Number.isFinite(Number(trimmed)) ? { value: Number(trimmed) } : { problem: WRONG.number }
  if (decl.type === "boolean")
    return trimmed === "true" || trimmed === "false" ? { value: trimmed === "true" } : { problem: WRONG.boolean }
  try {
    return { value: JSON.parse(trimmed) }
  } catch {
    return { problem: WRONG.json }
  }
}

/** Ошибки объявлений аргументов — словами, по одной на аргумент (через переводчик, #472). */
export function declarationProblems(decls: Meta["args"], t: BuffI18n.T = BuffI18n.english): string[] {
  return Object.entries(decls).flatMap(([name, decl]) => {
    if (!name.trim()) return [t("An argument has no name.")]
    if (decl.default !== undefined && !fits(decl.type, decl.default))
      return [t("{name}: the default value has the wrong type.", { name })]
    return []
  })
}
