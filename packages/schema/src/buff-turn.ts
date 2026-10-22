export * as BuffTurn from "./buff-turn.js"

import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"
import { define } from "./rpc.js"

/**
 * Сводка изменений хода и безопасный откат (#449). Под ответом видно, какие файлы ход изменил;
 * откат перед выполнением показывает, что вернётся, и проверяет, не трогал ли кто файлы уже
 * после хода: такие правки откат затрёт. Здесь правила, общие для ядра, окна и консоли;
 * предпросмотр считает ядро (`core/src/buff/turn.ts`).
 */

export const File = Schema.Struct({
  file: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  status: Schema.Literals(["added", "deleted", "modified"]),
  /** Файл менялся уже после хода — не агентом; откат эти правки затрёт. */
  external: Schema.Boolean,
})
export type File = typeof File.Type

const portable = Schema.toStandardSchemaV1
const Reason = portable(Schema.Struct({}))

export const Preview = Schema.Struct({
  /** Ведутся ли здесь снимки файлов: без них откат возвращает только переписку. */
  snapshots: Schema.Boolean,
  files: Schema.Array(File),
})
export type Preview = typeof Preview.Type

export const Rpc = define({
  id: "buff.turn",
  methods: {
    /** Что вернёт откат до этого сообщения человека — без выполнения. */
    preview: {
      input: portable(Schema.Struct({ sessionID: Schema.String, messageID: Schema.String })),
      output: portable(Preview),
      errors: { invalid: Reason },
    },
  },
  events: {},
})

// --- план отката ----------------------------------------------------------------------------

interface Step {
  readonly type: string
  readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: readonly string[] }
}

/**
 * Какие файлы вернёт откат сообщений (они идут по порядку, начиная с места отката) и между
 * какими снимками лежат их изменения — так же, как это считает сам откат в ядре.
 */
export function plan(messages: readonly Step[]): { files: string[]; from?: string; to?: string } {
  const steps = messages.flatMap((message) =>
    message.type === "assistant" && message.snapshot?.start ? [message.snapshot] : [],
  )
  const files = [...new Set(steps.flatMap((step) => step.files ?? []))]
  const from = steps[0]?.start
  const to = steps.findLast((step) => step.end)?.end
  return { files, ...(from ? { from } : {}), ...(to ? { to } : {}) }
}

// --- слова ----------------------------------------------------------------------------------

const lines = (files: readonly Pick<File, "additions" | "deletions">[]) =>
  `+${files.reduce((sum, item) => sum + item.additions, 0)} −${files.reduce((sum, item) => sum + item.deletions, 0)}`

/** Строка под ответом: сколько файлов ход изменил. */
export function changedLine(
  files: readonly Pick<File, "additions" | "deletions">[],
  n: BuffI18n.N = BuffI18n.englishPlural,
): string | undefined {
  if (!files.length) return undefined
  return `${n(files.length, "Changed {n} file|Changed {n} files")}  ${lines(files)}`
}

const STATUS: Record<File["status"], string | undefined> = { added: "new", deleted: "deleted", modified: undefined }

export function fileNote(
  file: Pick<File, "additions" | "deletions" | "status">,
  t: BuffI18n.T = BuffI18n.english,
): string {
  const status = STATUS[file.status]
  return [status && t(status), lines([file])].filter(Boolean).join(" · ")
}

const REWIND = "Messages after this point will be removed from the conversation."

/** Что сказать человеку перед откатом. */
export function verdict(
  preview: Preview,
  t: BuffI18n.T = BuffI18n.english,
  n: BuffI18n.N = BuffI18n.englishPlural,
): { safe: boolean; title: string; text: string } {
  if (!preview.snapshots)
    return {
      safe: true,
      title: t("Rewind the conversation"),
      text: `${t("File snapshots are not kept here (the folder is not under git or snapshots are off) — the files stay as they are.")} ${t(REWIND)}`,
    }
  if (!preview.files.length)
    return { safe: true, title: t("Rewind the conversation"), text: `${t("This turn did not change files.")} ${t(REWIND)}` }
  const external = preview.files.filter((item) => item.external).length
  if (!external)
    return {
      safe: true,
      title: t("The rewind is safe"),
      text: t("The files return to their state before the turn. After the rewind everything can be brought back."),
    }
  return {
    safe: false,
    title: t("There are edits made after the turn"),
    text: n(
      external,
      "{n} file was changed after the turn — not by the agent. The rewind replaces it with its version from before the turn; those edits disappear from the working copy.|{n} files were changed after the turn — not by the agent. The rewind replaces them with their versions from before the turn; those edits disappear from the working copy.",
    ),
  }
}

/** Строка после отката. */
export function revertedLine(
  files: number,
  t: BuffI18n.T = BuffI18n.english,
  n: BuffI18n.N = BuffI18n.englishPlural,
): string {
  if (!files) return t("Turn rewound: the messages are removed from the conversation, the files did not change.")
  return n(files, "Turn rewound: {n} file is back to its previous state.|Turn rewound: {n} files are back to their previous state.")
}
