export * as BuffSnapshotGit from "./buff-snapshot-git.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import type { BuffI18n } from "./buff-i18n.js"

/**
 * Git для снимков сессии (#495). Дифф и откат сессии держатся на снимках, а снимкам нужен git от
 * 2.35 — системный или встроенный в сборку. Когда подходящего нет, снимки отключены; раньше это
 * случалось молча, теперь окно и консоль говорят почему. Состояние отдаёт ядро (rpc
 * `buff.snapshot-git`), слова — здесь, общие для обоих экранов.
 */

export const Status = Schema.Struct({
  /** У снимков есть git от 2.35. */
  ready: Schema.Boolean,
  /** Почему нет: системный старый (`version`) или git нет вовсе. */
  reason: Schema.optional(Schema.Literals(["old", "absent"])),
  version: Schema.optional(Schema.String),
  /** Каталог — git-репозиторий: только там снимки и делаются. */
  repository: Schema.Boolean,
})
export type Status = typeof Status.Type

const portable = Schema.toStandardSchemaV1

export const Rpc = define({
  id: "buff.snapshot-git",
  methods: {
    status: { input: portable(Schema.Undefined), output: portable(Status), errors: {} },
  },
  events: {},
})

/** Что сказать человеку; снимки работают или каталог не репозиторий — ничего. */
export function warning(status: Status, t: BuffI18n.T): string | undefined {
  if (status.ready || !status.repository) return undefined
  if (status.reason === "old")
    return t("Session undo and changes are off: they need git 2.35 or newer, this computer has {version}.", {
      version: status.version ?? "?",
    })
  return t("Session undo and changes are off: install git 2.35 or newer.")
}
