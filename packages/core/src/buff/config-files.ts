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
/** Личная папка проекта (#951): у пользователя, но только для этого проекта. */
export type Local = "local"
export type Refusal = { readonly kind: "invalid" | "unwritable"; readonly message: string }

export const refuse = (kind: Refusal["kind"], message: string) => Effect.fail<Refusal>({ kind, message })

export function make<S extends Scope | Local = Scope>(input: {
  readonly config: Config.Interface
  readonly fs: FSUtil.Interface
  /**
   * Каталог конфигурации пользователя и каталог проекта. `local` — личная папка проекта; её
   * задаёт тот, кто умеет область `local` (тогда `S` её включает). Остальным документы личных
   * папок не видны вовсе: иначе они сошли бы за общие настройки пользователя.
   */
  readonly dirs: Record<Scope, string> & { readonly local?: string | undefined }
}) {
  const { fs, dirs } = input
  const inside = (directory: string, file: string) => file === directory || file.startsWith(directory + path.sep)
  const personal = path.join(dirs.user, BuffNames.PERSONAL_PROJECTS_DIR)
  const scopeOf = (file: string): S =>
    (inside(personal, file) ? "local" : inside(dirs.user, file) ? "user" : "project") as S
  const text = (file: string) => fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))

  /** Документы конфигурации с диска, от слабого к сильному — как их читает ядро. */
  const documents = input.config
    .entries()
    .pipe(
      Effect.map((entries) =>
        entries.flatMap((entry) =>
          entry.type === "document" && entry.path && (dirs.local !== undefined || !inside(personal, String(entry.path)))
            ? [{ file: String(entry.path), info: entry.info }]
            : [],
        ),
      ),
    )
  const files = documents.pipe(Effect.map((found) => found.map((document) => document.file)))

  /** Файл для новой записи области: уже существующий файл конфигурации, иначе новый. */
  const fileFor = Effect.fnUntraced(function* (scope: S) {
    const directory = dirs[scope]
    if (directory === undefined)
      return yield* refuse("invalid", BuffLocale.t("There is no project here: save it for all projects."))
    const existing = (yield* files).filter((file) => scopeOf(file) === scope).at(-1)
    if (existing) return existing
    const candidates = ConfigDiscovery.names.map((name) => path.join(directory, name))
    const onDisk = (yield* Effect.filter(candidates, fs.isFile)).at(-1)
    // Тот же выбор, что у ядра и у `buff mcp add`: у пользователя — .jsonc, в проекте — .json.
    return onDisk ?? path.join(directory, scope === "project" ? BuffNames.PROJECT_CONFIG_FILE : BuffNames.USER_CONFIG_FILE)
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
