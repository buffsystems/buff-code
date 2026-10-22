export * as BuffSkill from "./buff-skill.js"

import { Schema } from "effect"
import { BuffMarkdown } from "./buff-markdown.js"
import { BuffI18n } from "./buff-i18n.js"
import { define } from "./rpc.js"

/**
 * Управление навыками из интерфейса (#445): создать, поправить, удалить, включить и выключить,
 * подключить каталог с навыками — не открывая файлы руками. Здесь всё, что одинаково для окна
 * и консоли: области, проверка, текст файла навыка, слова для источника. Хранит и пишет ядро
 * (`core/src/buff/skill.ts`).
 */

/** Где лежит свой навык: у пользователя (все проекты) или в проекте (уезжает в репозиторий). */
export const Scope = Schema.Literals(["user", "project"])
export type Scope = typeof Scope.Type

/**
 * Откуда навык: свой (`user`, `project`), из подключённого каталога или каталога другого
 * агента (`external`), от самого Buff Code или плагина (`builtin`). Правятся только свои.
 */
export const Origin = Schema.Literals(["user", "project", "external", "builtin"])
export type Origin = typeof Origin.Type

export const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  scope: Origin,
  /** Файл навыка; у встроенных его нет. */
  path: Schema.optional(Schema.String),
  /** Выключенный навык не виден ни модели, ни в подсказках поля ввода. */
  enabled: Schema.Boolean,
})
export type Entry = typeof Entry.Type

/** Подключённый источник навыков: каталог или адрес из настройки `skills`. */
export const Source = Schema.Struct({ scope: Scope, source: Schema.String })
export type Source = typeof Source.Type

const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Reason = portable(Schema.Struct({}))
const Target = Schema.Struct({ scope: Scope, id: Schema.String })
const Failures = { invalid: Reason, unwritable: Reason }

export const Rpc = define({
  id: "buff.skill",
  methods: {
    list: {
      input: Nothing,
      output: portable(Schema.Struct({ skills: Schema.Array(Entry), sources: Schema.Array(Source) })),
    },
    /** Текст своего навыка для правки. */
    read: {
      input: portable(Target),
      output: portable(Schema.Struct({ name: Schema.String, description: Schema.String, body: Schema.String })),
      errors: Failures,
    },
    /** Создать или переписать навык; `previous` — прежние область и идентификатор при переносе. */
    save: {
      input: portable(
        Schema.Struct({
          ...Target.fields,
          name: Schema.String,
          description: Schema.String,
          body: Schema.String,
          previous: Schema.optional(Target),
        }),
      ),
      output: Nothing,
      errors: Failures,
    },
    remove: { input: portable(Target), output: Nothing, errors: Failures },
    /** Включить или выключить любой навык — файл остаётся на месте. */
    enable: {
      input: portable(Schema.Struct({ id: Schema.String, enabled: Schema.Boolean })),
      output: Nothing,
      errors: Failures,
    },
    /** Подключить каталог или адрес с навыками; `attached: false` — отключить. */
    attach: {
      input: portable(Schema.Struct({ scope: Scope, source: Schema.String, attached: Schema.Boolean })),
      output: Nothing,
      errors: Failures,
    },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})

// --- проверка -------------------------------------------------------------------------------

export function idProblem(id: string, t: BuffI18n.T = BuffI18n.english): string | undefined {
  return /^[a-z0-9][a-z0-9-]*$/.test(id)
    ? undefined
    : t("The ID is lowercase Latin letters, digits and hyphen, for example release-notes.")
}

export function problem(
  skill: { id: string; description: string; body: string },
  t: BuffI18n.T = BuffI18n.english,
): string | undefined {
  const id = idProblem(skill.id, t)
  if (id) return id
  if (!skill.description.trim())
    return t("Describe when to use the skill: the model decides by the description whether it is needed.")
  if (!skill.body.trim()) return t("Write the instruction: what to do when the skill is used.")
  return undefined
}

export function sourceProblem(source: string, t: BuffI18n.T = BuffI18n.english): string | undefined {
  return source.trim() ? undefined : t("Enter a directory with skills or an address where they are published.")
}

// --- файл навыка ----------------------------------------------------------------------------

export interface Parts {
  readonly name?: string
  readonly description?: string
  readonly body: string
}

export function fileParts(text: string): Parts {
  const { values, body } = BuffMarkdown.parts(text, ["name", "description"])
  return { name: values.name, description: values.description, body }
}

type Written = { readonly name: string; readonly description: string; readonly body: string }

/** Тот же файл с новыми именем, описанием и инструкцией; прочие записи шапки остаются. */
export function fileEdited(text: string, skill: Written): string {
  return BuffMarkdown.edited(
    text,
    [
      ["name", skill.name],
      ["description", skill.description],
    ],
    skill.body,
  )
}

/** Текст нового навыка. */
export function fileText(skill: Written): string {
  return fileEdited("", skill)
}

// --- слова ----------------------------------------------------------------------------------

const SCOPE_LABEL: Record<Origin, string> = {
  project: "project",
  user: "my skill",
  external: "attached",
  builtin: "built-in skill",
}

/** Откуда навык — одним словом: в списке навыков и в подсказках поля ввода. */
export function scopeLabel(scope: Origin, t: BuffI18n.T = BuffI18n.english): string {
  return t(SCOPE_LABEL[scope])
}

/** Подпись навыка в подсказках поля ввода: откуда он, затем когда применять. */
export function suggestionNote(
  scope: Origin | undefined,
  description: string | undefined,
  t: BuffI18n.T = BuffI18n.english,
): string | undefined {
  const text = description?.replace(/\s+/g, " ").trim()
  if (!scope) return text || undefined
  return text ? `${scopeLabel(scope, t)} · ${text}` : scopeLabel(scope, t)
}
