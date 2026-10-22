export * as BuffMemory from "./buff-memory.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Память из интерфейса (#446). Память — это файлы AGENTS.md: общий у пользователя (все проекты)
 * и файлы проекта; их текст модель получает в начале каждой сессии. Здесь — список, чтение и
 * запись, выключатель у файла и общий; слова — одни для окна и консоли. Хранит и пишет ядро
 * (`core/src/buff/memory.ts`).
 */

export const Scope = Schema.Literals(["user", "project"])
export type Scope = typeof Scope.Type

export const File = Schema.Struct({
  path: Schema.String,
  scope: Scope,
  /** Файла может ещё не быть: место для него показывается, чтобы было куда записать. */
  exists: Schema.Boolean,
  /** Когда изменён, мс. */
  modified: Schema.optional(Schema.Number),
  /** Выключенный файл остаётся на диске, но модель его не получает. */
  enabled: Schema.Boolean,
})
export type File = typeof File.Type

const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Reason = portable(Schema.Struct({}))
const Failures = { invalid: Reason, unwritable: Reason }
const Target = Schema.Struct({ path: Schema.String })

export const Rpc = define({
  id: "buff.memory",
  methods: {
    /** `enabled` — общий выключатель: без него модель не получает ни одного файла памяти. */
    list: { input: Nothing, output: portable(Schema.Struct({ enabled: Schema.Boolean, files: Schema.Array(File) })) },
    read: { input: portable(Target), output: portable(Schema.Struct({ text: Schema.String })), errors: Failures },
    write: {
      input: portable(Schema.Struct({ ...Target.fields, text: Schema.String })),
      output: Nothing,
      errors: Failures,
    },
    /** Включить или выключить файл; без `path` — всю память. */
    enable: {
      input: portable(Schema.Struct({ path: Schema.optional(Schema.String), enabled: Schema.Boolean })),
      output: Nothing,
      errors: Failures,
    },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})

// --- слова ----------------------------------------------------------------------------------

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const two = (value: number) => String(value).padStart(2, "0")

/** Когда файл изменён — словами, пока это недавно, иначе датой. */
export function changed(modified: number, now: number, t: BuffI18n.T = BuffI18n.english): string {
  const ago = now - modified
  if (ago < MINUTE) return t("just now")
  if (ago < HOUR) return t("{n} min ago", { n: Math.floor(ago / MINUTE) })
  if (ago < DAY) return t("{n} h ago", { n: Math.floor(ago / HOUR) })
  if (ago < 2 * DAY) return t("yesterday")
  const date = new Date(modified)
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()}`
}

/** Что сказать о файле под его путём; `memory` — общий выключатель. */
export function note(file: File, memory: boolean, now: number, t: BuffI18n.T = BuffI18n.english): string {
  if (!file.exists || file.modified === undefined)
    return t("There is no file yet — it appears when you write the first note into it.")
  if (!memory) return t("Memory is off: the model does not read it.")
  if (!file.enabled) return t("Turned off: the model does not read it.")
  return t("changed {when}", { when: changed(file.modified, now, t) })
}

const SCOPE_TITLE: Record<Scope, string> = {
  user: "Your memory — in all projects",
  project: "Project memory",
}

export function scopeTitle(scope: Scope, t: BuffI18n.T = BuffI18n.english): string {
  return t(SCOPE_TITLE[scope])
}

/** Что такое память — одной фразой над списком. */
export const ABOUT =
  "Memory is notes in AGENTS.md files: project rules, agreements, frequent commands. The model gets them at the start of every session. AGENTS.md files in nested directories are picked up by themselves when the agent reads files from there."
