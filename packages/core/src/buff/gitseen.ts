export * as BuffGitSeen from "./gitseen.js"

import { define } from "@opencode/plugin/effect/plugin"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { execFileSync } from "node:child_process"
import { existsSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import type { Database } from "../database/database.js"
import { gitExecutable } from "../util/git-executable.js"

/**
 * «Git видит файл» (#245) — признак файла проекта в панели изменений: отслеживаемый или новый
 * неигнорируемый — да; игнорируемый, вне репозитория, в исчезнувшем клоне — нет. Вердикт
 * историчен (клон удаляется после слияния), поэтому берётся ЗДЕСЬ, в момент правки, пока клон
 * под рукой, и пишется в таблицу базы движка `buff_git_seen`: дальше она едет в склад той же
 * очередью, что и всё остальное (#439). Файл судит репозиторий, которому он принадлежит:
 * внутри подмодуля — подмодуль, поэтому путь сперва ведётся к ближайшему корню.
 */

type Db = Database.Interface["db"]

export const TABLE = "buff_git_seen"

const CHANGE_TOOLS = new Set(["edit", "write", "patch", "apply_patch"])

/** Пути файлов, которых коснулась правка: из отчёта инструмента (`metadata.files[].file` у
 *  edit и patch) и из его входа (`path` у write и edit — write о файле не отчитывается). */
export function paths(tool: string, result: unknown, input?: unknown): string[] {
  const name = String(tool).replace(/^tools\./, "").split(".").pop() ?? ""
  if (!CHANGE_TOOLS.has(name)) return []
  const meta = (result as { metadata?: { files?: unknown } } | undefined)?.metadata
  const files = Array.isArray(meta?.files) ? meta.files : []
  const reported = files
    .map((f) => (typeof f === "object" && f && typeof (f as { file?: unknown }).file === "string" ? (f as { file: string }).file : ""))
    .filter(Boolean)
  const arg = (input as { path?: unknown; filePath?: unknown } | undefined) ?? {}
  const own = typeof arg.path === "string" ? arg.path : typeof arg.filePath === "string" ? arg.filePath : ""
  return [...new Set(own ? [...reported, own] : reported)]
}

function git(cwd: string, ...args: string[]): string | null {
  try {
    return execFileSync(gitExecutable, ["-c", "safe.directory=*", "-C", cwd, ...args], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return null
  }
}

/** Корень репозитория, владеющего путём, — от ближайшего СУЩЕСТВУЮЩЕГО предка (сам файл
 *  может быть уже удалён); null — репозитория нет. */
function toplevel(file: string, cache: Map<string, string | null>): string | null {
  let dir = path.dirname(file)
  while (dir && !(existsSync(dir) && statSync(dir).isDirectory())) {
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
  if (!cache.has(dir)) cache.set(dir, git(dir, "rev-parse", "--show-toplevel")?.trim() || null)
  return cache.get(dir) ?? null
}

/** Вердикт по каждому абсолютному пути. `cwd` исчез — говорить не о чем (null). */
export function verdict(cwd: string, files: string[]): Record<string, boolean> | null {
  if (!existsSync(cwd)) return null
  const cache = new Map<string, string | null>()
  const out: Record<string, boolean> = {}
  const byTop = new Map<string, string[]>()
  for (const f of files) {
    const top = toplevel(f, cache)
    if (!top) out[f] = false
    else byTop.set(top, [...(byTop.get(top) ?? []), f])
  }
  for (const [top, group] of byTop) {
    const rel = group.map((f) => path.relative(top, safeReal(f)))
    const listed = new Set((git(top, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...rel) ?? "").split("\0").filter(Boolean))
    group.forEach((f, i) => (out[f] = listed.has(rel[i])))
  }
  return out
}

function safeReal(file: string): string {
  try {
    return realpathSync(file)
  } catch {
    return file
  }
}

// Общая на процесс (см. outbox-sender.ts: модуль может оказаться в двух чанках сборки).
const HANDLE = Symbol.for("buff.gitseen.db")
const holder = globalThis as unknown as { [HANDLE]?: Db }

/** Слой базы отдаёт сюда свою ручку: плагин пишет вердикты в ту же базу движка. */
export function attach(db: Db): void {
  holder[HANDLE] = db
}

const current = (): Db | null => holder[HANDLE] ?? null

export const install = Effect.fn("BuffGitSeen.install")(function* (db: Db) {
  yield* db.run(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "${TABLE}" (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, message_id TEXT NOT NULL, call_id TEXT NOT NULL, path TEXT NOT NULL, seen INTEGER NOT NULL, time_created INTEGER NOT NULL)`,
    ),
  )
})

const lit = (v: string) => `'${v.replaceAll("'", "''")}'`

export const Plugin = define({
  id: "buff.gitseen",
  effect: Effect.fn(function* (ctx) {
    const cwd = ctx.location.directory
    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        const handle = current()
        if (event.status !== "completed" || !handle) return
        const files = paths(event.tool, event.result, event.input).map((f) => (path.isAbsolute(f) ? f : path.resolve(cwd, f)))
        if (!files.length) return
        const seen = verdict(cwd, files)
        if (!seen) return
        const rows = files.map(
          (f) =>
            `(${lit(event.sessionID)}, ${lit(event.messageID)}, ${lit(event.id)}, ${lit(f)}, ${seen[f] ? 1 : 0}, ${Date.now()})`,
        )
        yield* handle.run(
          sql.raw(`INSERT INTO "${TABLE}" (session_id, message_id, call_id, path, seen, time_created) VALUES ${rows.join(", ")}`),
        )
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("git_seen: not recorded", { cause }))),
    )
  }),
})
