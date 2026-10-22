export * as BuffConfigFiles from "./config-files.js"

import path from "node:path"
import { BuffNames } from "@opencode/schema/buff-names"
import { Effect } from "effect"
import type { FSUtil } from "@opencode/util/fs-util"
import type { Config } from "../config.js"
import { ConfigDiscovery } from "../config/discovery.js"
import { BuffLocale } from "./locale.js"

/**
 * Файлы конфигурации для настроек из интерфейса (#444, #445): какие есть, чья область у
 * каждого, в какой писать новое и как править текст, не задев остального. Общее для MCP и
 * навыков — выбор файла и запись у них одинаковы.
 */
export type Scope = "user" | "project"
export type Refusal = { readonly kind: "invalid" | "unwritable"; readonly message: string }

export const refuse = (kind: Refusal["kind"], message: string) => Effect.fail<Refusal>({ kind, message })

export function make(input: {
  readonly config: Config.Interface
  readonly fs: FSUtil.Interface
  /** Каталог конфигурации пользователя и каталог проекта. */
  readonly dirs: Record<Scope, string>
}) {
  const { fs, dirs } = input
  const inside = (directory: string, file: string) => file === directory || file.startsWith(directory + path.sep)
  const scopeOf = (file: string): Scope => (inside(dirs.user, file) ? "user" : "project")
  const text = (file: string) => fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))

  /** Документы конфигурации с диска, от слабого к сильному — как их читает ядро. */
  const documents = input.config
    .entries()
    .pipe(
      Effect.map((entries) =>
        entries.flatMap((entry) =>
          entry.type === "document" && entry.path ? [{ file: String(entry.path), info: entry.info }] : [],
        ),
      ),
    )
  const files = documents.pipe(Effect.map((found) => found.map((document) => document.file)))

  /** Файл для новой записи области: уже существующий файл конфигурации, иначе новый. */
  const fileFor = Effect.fnUntraced(function* (scope: Scope) {
    const existing = (yield* files).filter((file) => scopeOf(file) === scope).at(-1)
    if (existing) return existing
    const candidates = ConfigDiscovery.names.map((name) => path.join(dirs[scope], name))
    const onDisk = (yield* Effect.filter(candidates, fs.isFile)).at(-1)
    // Тот же выбор, что у ядра и у `buff mcp add`: у пользователя — .jsonc, в проекте — .json.
    return onDisk ?? path.join(dirs[scope], scope === "user" ? BuffNames.USER_CONFIG_FILE : BuffNames.PROJECT_CONFIG_FILE)
  })

  /** Переписать файл; правка, которая не удалась (файл с ошибкой разметки), его не трогает. */
  const rewrite = Effect.fnUntraced(function* (file: string, change: (text: string) => string) {
    const before = (yield* text(file)) ?? ""
    const after = yield* Effect.try({
      try: () => change(before),
      catch: (cause): Refusal => ({
        kind: "unwritable",
        message: cause instanceof Error ? cause.message : String(cause),
      }),
    })
    if (after === before) return
    yield* write(file, after)
  })

  const write = (file: string, content: string) =>
    fs
      .writeWithDirs(file, content)
      .pipe(
        Effect.mapError(
          (cause): Refusal => ({
            kind: "unwritable",
            message: BuffLocale.t("Could not write {file}: {cause}", { file, cause: cause.message }),
          }),
        ),
      )

  return { dirs, inside, scopeOf, text, documents, files, fileFor, rewrite, write }
}
