export * as BuffJournal from "./journal.js"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { LogJournal } from "@opencode/util/observability/journal"
import type { Database } from "../database/database.js"

/**
 * Журнал движка в склад (#538). Склад хранит журнал прогона для аудита по запросу ИБ клиента
 * (#389) и раньше сам читал файл журнала с общего диска. Теперь строки, накопленные логгером
 * (`LogJournal`), ложатся в таблицу базы движка `buff_log` частями — и уезжают той же
 * очередью сквозной записи (#439), что и остальные таблицы. Номер части — автоинкремент
 * базы: при переносе базы на другую машину он продолжается, а не начинается заново, поэтому
 * ключ строки в складе (файл-источник + номер) не сталкивается. Таблица заводится до
 * триггеров очереди, чтобы и она дублировалась в склад.
 */

type Db = Database.Interface["db"]

export const TABLE = "buff_log"

/** Предел одной части: строка очереди по дороге в склад едет в пачке до полумегабайта. */
export const CHUNK_BYTES = 64 * 1024

/** Как часто накопленное переносится в базу. */
export const INTERVAL = "1 second"

export const install = Effect.fn("BuffJournal.install")(function* (db: Db) {
  yield* db.run(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT NOT NULL, time_created INTEGER NOT NULL, chunk TEXT NOT NULL)`,
    ),
  )
})

/** Строки → части не длиннее предела; строка не делится, слишком длинная едет одна. */
export function chunks(lines: readonly string[], max = CHUNK_BYTES): string[] {
  const out: string[] = []
  let current: string[] = []
  let size = 0
  for (const line of lines) {
    if (current.length && size + line.length + 1 > max) {
      out.push(current.join("\n"))
      current = []
      size = 0
    }
    current.push(line)
    size += line.length + 1
  }
  if (current.length) out.push(current.join("\n"))
  return out
}

/** Накопленное логгером → части в базе. */
export const flush = Effect.fn("BuffJournal.flush")(function* (db: Db, run: string) {
  const { lines, dropped } = LogJournal.take()
  const all = dropped ? [`[buff] journal: ${dropped} line(s) dropped before delivery`, ...lines] : lines
  const now = Date.now()
  for (const chunk of chunks(all)) {
    yield* db.run(sql`INSERT INTO buff_log (run, time_created, chunk) VALUES (${run}, ${now}, ${chunk})`)
  }
})
