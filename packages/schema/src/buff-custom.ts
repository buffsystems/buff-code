export * as BuffCustom from "./buff-custom.js"

import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"
import { BuffMarkdown } from "./buff-markdown.js"
import { define } from "./rpc.js"

/**
 * Команды и субагенты из интерфейса (#446): создать, поправить, удалить, включить и выключить,
 * не открывая файлы. Оба вида — файл Markdown с шапкой, поэтому правила, форма и хранение у
 * них общие, а различия собраны в описании вида (`kinds`). Здесь всё, что одинаково для окна и
 * консоли; хранит и пишет ядро (`core/src/buff/custom.ts`).
 */

export const KindName = Schema.Literals(["command", "agent"])
export type KindName = typeof KindName.Type

/** Где лежит своя запись: у пользователя (все проекты) или в проекте (уезжает в репозиторий). */
export const Scope = Schema.Literals(["user", "project"])
export type Scope = typeof Scope.Type

/**
 * Откуда запись: свой файл (`user`, `project`), ключ файла настроек (`config`) или сам
 * Buff Code и его расширения (`builtin`). Правятся только свои файлы.
 */
export const Origin = Schema.Literals(["user", "project", "config", "builtin"])
export type Origin = typeof Origin.Type

const Values = Schema.Record(Schema.String, Schema.String)

export const Entry = Schema.Struct({
  id: Schema.String,
  description: Schema.optional(Schema.String),
  scope: Origin,
  /** Файл записи; у встроенных его нет. */
  path: Schema.optional(Schema.String),
  /** Выключенной записи нет ни у модели, ни в подсказках поля ввода. */
  enabled: Schema.Boolean,
  /** Значения шапки, которые показывает список (режим, модель…). */
  values: Values,
  /** Команда проекта: подтверждена ли она человеком; у остальных записей поля нет. */
  trusted: Schema.optional(Schema.Boolean),
})
export type Entry = typeof Entry.Type

const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Reason = portable(Schema.Struct({}))
const Target = Schema.Struct({ kind: KindName, scope: Scope, id: Schema.String })
const Failures = { invalid: Reason, unwritable: Reason }

export const Rpc = define({
  id: "buff.custom",
  methods: {
    list: { input: portable(Schema.Struct({ kind: KindName })), output: portable(Schema.Array(Entry)) },
    /** Своя запись для правки: значения шапки и текст. */
    read: {
      input: portable(Target),
      output: portable(Schema.Struct({ values: Values, body: Schema.String })),
      errors: Failures,
    },
    /** Создать или переписать запись; `previous` — прежние область и имя при переносе. */
    save: {
      input: portable(
        Schema.Struct({
          ...Target.fields,
          values: Values,
          body: Schema.String,
          previous: Schema.optional(Schema.Struct({ scope: Scope, id: Schema.String })),
        }),
      ),
      output: Nothing,
      errors: Failures,
    },
    remove: { input: portable(Target), output: Nothing, errors: Failures },
    /** Включить или выключить любую запись — файл остаётся на месте. */
    enable: {
      input: portable(Schema.Struct({ kind: KindName, id: Schema.String, enabled: Schema.Boolean })),
      output: Nothing,
      errors: Failures,
    },
    /** Что человек проверяет, прежде чем довериться команде проекта: её текст и его отпечаток. */
    review: {
      input: portable(Schema.Struct({ kind: KindName, id: Schema.String })),
      output: portable(Schema.Struct({ text: Schema.String, token: Schema.String })),
      errors: Failures,
    },
    /** Подтвердить просмотренное (`token` из `review`) или отозвать доверие (без `token`). */
    trust: {
      input: portable(Schema.Struct({ kind: KindName, id: Schema.String, token: Schema.optional(Schema.String) })),
      output: Nothing,
      errors: Failures,
    },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})

// --- описание вида --------------------------------------------------------------------------

export interface Field {
  /** Запись шапки файла. */
  readonly key: string
  readonly label: string
  readonly hint?: string
  readonly placeholder?: string
  /** Поле-выбор; первый вариант — значение по умолчанию (пустое значение в файл не пишется). */
  readonly options?: readonly { readonly value: string; readonly label: string }[]
  /** Что сказать, если поле пусто; без этого поле необязательное. */
  readonly required?: string
  /** Что значит отсутствие записи в файле, если это не первый вариант выбора. */
  readonly absent?: string
  /** Значение — модель в виде провайдер/модель. */
  readonly model?: boolean
}

export interface Kind {
  readonly name: KindName
  /** Каталог новых записей в каталоге настроек. */
  readonly directory: string
  /** Каталоги, из которых ядро читает записи. */
  readonly directories: readonly string[]
  /** Запись может лежать в папке (`git/sync`). */
  readonly nested: boolean
  /** Знак вызова в поле ввода. */
  readonly sign: string
  readonly idProblem: string
  readonly idPlaceholder: string
  readonly idHint: string
  readonly fields: readonly Field[]
  readonly body: {
    readonly label: string
    readonly hint: string
    readonly placeholder: string
    readonly required: string
  }
  readonly origins: Record<Origin, string>
  /** Слова интерфейса. */
  readonly words: {
    /** Название раздела. */
    readonly title: string
    readonly create: string
    readonly created: string
    readonly edit: (id: string, t?: BuffI18n.T) => string
    readonly remove: (id: string, t?: BuffI18n.T) => string
    readonly search: string
    readonly groups: Record<Origin, string>
    readonly empty: Record<Scope, string>
    readonly scopeNote: Record<Scope, string>
    readonly disabled: string
    readonly readOnly: string
    /** Одним словом в списке консоли. */
    readonly off: string
    readonly pick: { readonly edit: string; readonly remove: string; readonly toggle: string }
    readonly none: string
  }
}

const MODEL: Field = {
  key: "model",
  label: "Model",
  hint: "Empty — the session's model.",
  placeholder: "buff/buff",
  model: true,
}
const MODEL_PROBLEM = "The model is written as provider/model, for example buff/buff. Empty — the session's model."

export const kinds: Record<KindName, Kind> = {
  command: {
    name: "command",
    directory: "commands",
    directories: ["command", "commands"],
    nested: true,
    sign: "/",
    idProblem:
      "The name is lowercase Latin letters, digits and hyphen, for example deploy; a folder goes with a slash: git/sync.",
    idPlaceholder: "deploy",
    idHint: "The command is called by name in the input field: /deploy.",
    fields: [
      {
        key: "description",
        label: "Description",
        hint: "Shown in the command list under «/».",
        placeholder: "Deploy to the stand",
      },
      {
        key: "agent",
        label: "Agent",
        hint: "Who runs the command. Empty — the session's current agent.",
        placeholder: "build",
      },
      MODEL,
      {
        key: "subagent",
        label: "Where to run",
        options: [
          { value: "", label: "In the current session" },
          { value: "true", label: "As a separate subagent" },
        ],
      },
    ],
    body: {
      label: "Command text",
      hint: "Goes to the model when the command is called. $ARGUMENTS — everything written after the name; $1, $2 — word by word.",
      placeholder: "Deploy the $ARGUMENTS branch to the stand and check that the service came up.",
      required: "Write the command text: it goes to the model when the command is called.",
    },
    origins: { project: "project", user: "my command", config: "from the settings file", builtin: "built-in command" },
    words: {
      title: "Commands",
      create: "Create command",
      created: "New command",
      edit: (id, t = BuffI18n.english) => t("Command /{id}", { id }),
      remove: (id, t = BuffI18n.english) => t("Delete command /{id}?", { id }),
      search: "Search by name and description",
      groups: {
        project: "Project commands",
        user: "Your commands — in all projects",
        config: "Commands from the settings file",
        builtin: "Built-in commands",
      },
      empty: { project: "This project has no commands of its own.", user: "No commands of your own yet." },
      scopeNote: {
        project:
          "The command goes into the project's .buffcode folder and into the repository — the whole team gets it.",
        user: "The command stays on this machine, in your configuration.",
      },
      disabled: "Disabled: it is not in the «/» list.",
      readOnly: "Edited in the settings file.",
      off: "turned off",
      pick: {
        edit: "Which command to edit",
        remove: "Which command to delete",
        toggle: "Which command to turn on or off",
      },
      none: "No commands of your own yet. Built-in ones and those in the settings file are not edited here.",
    },
  },
  agent: {
    name: "agent",
    directory: "agents",
    directories: ["agent", "agents"],
    nested: false,
    sign: "@",
    idProblem: "The name is lowercase Latin letters, digits and hyphen, for example reviewer.",
    idPlaceholder: "reviewer",
    idHint: "The subagent is called by name in the input field: @reviewer.",
    fields: [
      {
        key: "description",
        label: "When to call",
        hint: "By this description the main agent decides whom to give the work to.",
        placeholder: "When changes need checking before a merge",
        required:
          "Describe when to call the subagent: by the description the main agent decides whom to give the work to.",
      },
      {
        key: "mode",
        label: "Mode",
        options: [
          { value: "subagent", label: "Subagent — the main agent calls it" },
          { value: "primary", label: "Main — chosen in the input field" },
          { value: "all", label: "Both" },
        ],
        absent: "all",
      },
      MODEL,
    ],
    body: {
      label: "Instruction",
      hint: "Who it is and how it works — its system instruction.",
      placeholder:
        "You are a reviewer. Check the diff against the list: tests, names, boundaries. Answer with a list of remarks.",
      required: "Write the subagent's instruction: who it is and how it works.",
    },
    origins: { project: "project", user: "my agent", config: "from the settings file", builtin: "built-in agent" },
    words: {
      title: "Subagents",
      create: "Create subagent",
      created: "New subagent",
      edit: (id, t = BuffI18n.english) => t("Subagent @{id}", { id }),
      remove: (id, t = BuffI18n.english) => t("Delete subagent @{id}?", { id }),
      search: "Search by name and description",
      groups: {
        project: "Project subagents",
        user: "Your subagents — in all projects",
        config: "Subagents from the settings file",
        builtin: "Built-in agents",
      },
      empty: { project: "This project has no subagents of its own.", user: "No subagents of your own yet." },
      scopeNote: {
        project:
          "The subagent goes into the project's .buffcode folder and into the repository — the whole team gets it.",
        user: "The subagent stays on this machine, in your configuration.",
      },
      disabled: "Disabled: it cannot be called or chosen.",
      readOnly: "Edited in the settings file.",
      off: "disabled",
      pick: {
        edit: "Which subagent to edit",
        remove: "Which subagent to delete",
        toggle: "Which agent to turn on or off",
      },
      none: "No subagents of your own yet. Built-in ones and those in the settings file are not edited here.",
    },
  },
}

// --- проверка -------------------------------------------------------------------------------

const PART = "[a-z0-9][a-z0-9-]*"

export function idProblem(kind: Kind, id: string, t: BuffI18n.T = BuffI18n.english): string | undefined {
  const pattern = kind.nested ? new RegExp(`^${PART}(/${PART})*$`) : new RegExp(`^${PART}$`)
  return pattern.test(id) ? undefined : t(kind.idProblem)
}

export interface Draft {
  readonly id: string
  readonly values: Readonly<Record<string, string>>
  readonly body: string
}

function fieldProblem(field: Field, value: string, t: BuffI18n.T): string | undefined {
  if (!value) return field.required && t(field.required)
  if (field.options && !field.options.some((option) => option.value === value))
    return t("«{field}»: choose one of the offered options.", { field: t(field.label) })
  if (field.model && !/^[^/#\s]+\/[^#\s]+(#[^#\s]+)?$/.test(value)) return t(MODEL_PROBLEM)
  return undefined
}

export function problem(kind: Kind, draft: Draft, t: BuffI18n.T = BuffI18n.english): string | undefined {
  return (
    idProblem(kind, draft.id, t) ??
    kind.fields.map((field) => fieldProblem(field, draft.values[field.key]?.trim() ?? "", t)).find(Boolean) ??
    (draft.body.trim() ? undefined : t(kind.body.required))
  )
}

/** С чего начинается форма: у новой записи — первые варианты выборов, у существующей — то, что значит её файл. */
export function formValues(kind: Kind, stored: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const implied = kind.fields.flatMap((field) => {
    const value = stored ? field.absent : field.options?.[0].value
    return value && !stored?.[field.key] ? [[field.key, value] as const] : []
  })
  return { ...stored, ...Object.fromEntries(implied) }
}

// --- файл -----------------------------------------------------------------------------------

type Content = { readonly values: Readonly<Record<string, string>>; readonly body: string }

/** Значения формы и текст из файла записи. */
export function fileParts(kind: Kind, text: string): { values: Record<string, string>; body: string } {
  const parts = BuffMarkdown.parts(
    text,
    kind.fields.map((field) => field.key),
  )
  return {
    values: Object.fromEntries(Object.entries(parts.values).flatMap(([key, value]) => (value ? [[key, value]] : []))),
    body: parts.body,
  }
}

/** Тот же файл с новыми значениями и текстом; прочие записи шапки остаются. Пустой текст — новый файл. */
export function fileEdited(kind: Kind, text: string, content: Content): string {
  return BuffMarkdown.edited(
    text,
    kind.fields.map((field) => [field.key, content.values[field.key]] as const),
    content.body,
  )
}

/** Файл новой записи — относительно каталога настроек области. */
export function fileName(kind: Kind, id: string): string {
  return `${kind.directory}/${id}.md`
}

/** Имя записи по её файлу относительно каталога настроек — так же, как его выводит ядро. */
export function idOf(kind: Kind, relative: string): string | undefined {
  const [directory, ...rest] = relative.replaceAll("\\", "/").split("/")
  if (!kind.directories.includes(directory) || !rest.length || !relative.endsWith(".md")) return undefined
  return rest.join("/").replace(/\.md$/, "")
}

// --- доверие --------------------------------------------------------------------------------

/**
 * Подтверждения требует то, что пришло из проекта и само что-то запускает: команда может
 * вставлять вывод оболочки. Субагент — только инструкция, его инструменты и так спрашивают.
 */
export function needsTrust(kind: Kind, origin: "user" | "project"): boolean {
  return kind.name === "command" && origin === "project"
}

export function untrusted(id: string, t: BuffI18n.T = BuffI18n.english): string {
  return t(
    "The project command /{id} is not confirmed and was not run. Check its text and confirm it: settings → Extensions → Commands, in the console — /trust.",
    { id },
  )
}

/** Что сказать в строке неподтверждённой записи. */
export const UNTRUSTED_NOTE = "Not confirmed: it came from the project and will not run until you check its text."

// --- слова ----------------------------------------------------------------------------------

/** Как запись вызывают в поле ввода. */
export function mention(kind: Kind, id: string): string {
  return kind.sign + id
}

/** Откуда запись — одним словом. */
export function originLabel(kind: Kind, origin: Origin): string {
  return kind.origins[origin]
}
