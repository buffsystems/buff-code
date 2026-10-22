export * as BuffContext from "./buff-context.js"

import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"
import { define } from "./rpc.js"

/**
 * Текущий рабочий контекст Buff Code (#391): организация → проект или «без проекта» →
 * пространства знаний. Выбирается за каталогом и виден всегда. Определение общее для
 * ядра (где он хранится) и клиентов — консоли, терминального интерфейса и десктопа.
 */

export const Choice = Schema.Struct({
  org: Schema.String,
  /** null — режим «без проекта»: работа в организации без привязки к проекту. */
  project: Schema.NullOr(Schema.String),
  spaces: Schema.Array(Schema.String),
})
export type Choice = typeof Choice.Type

const Item = Schema.Struct({ org: Schema.String, name: Schema.String })

/** Из чего выбирать — ровно то, что разрешено токену разработчика. */
export const Options = Schema.Struct({
  orgs: Schema.Array(Schema.String),
  projects: Schema.Array(Item),
  spaces: Schema.Array(Item),
})
export type Options = typeof Options.Type

// Standard Schema, not bare Effect schemas: the promise client (console, desktop) accepts
// only portable definitions.
const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Reason = portable(Schema.Struct({}))

export const Rpc = define({
  id: "buff.context",
  methods: {
    get: { input: Nothing, output: portable(Schema.NullOr(Choice)) },
    /** Каталог, где контекст выбирали последним (#466): по нему настройки показывают модели. */
    lastDirectory: { input: Nothing, output: portable(Schema.NullOr(Schema.String)) },
    options: { input: Nothing, output: portable(Options), errors: { signed_out: Reason, unreachable: Reason } },
    set: {
      input: portable(Choice),
      output: portable(Choice),
      errors: { signed_out: Reason, unreachable: Reason, not_allowed: Reason },
    },
  },
  events: { changed: { schema: portable(Choice) } },
})

/** Подпись контекста — одна на все экраны: «acme › shop · 1 пр.»; слова — через переводчика экрана (#472). */
export function label(choice: Choice | null, t: BuffI18n.T = BuffI18n.english): string {
  if (!choice) return t("no context chosen")
  const head = `${choice.org} › ${choice.project ?? t("no project")}`
  return choice.spaces.length ? `${head} · ${t("{n} sp.", { n: choice.spaces.length })}` : head
}

/** Что подсветить в выборе проекта: прежний выбор в этой же организации, иначе ничего —
 *  первое подтверждение не должно молча означать «без проекта». */
export function preselectProject(current: Choice | null, org: string): string | null | undefined {
  return current && current.org === org ? current.project : undefined
}
