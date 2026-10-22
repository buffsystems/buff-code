export * as BuffOutbox from "./outbox.js"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database.js"

/**
 * Сквозная запись (#439): каждая запись движка в свою базу — INSERT, UPDATE, DELETE в любую
 * таблицу — дублируется строкой исходящей очереди `buff_outbox`. Делают это триггеры SQLite,
 * в той же транзакции, что и сама запись: ни один путь записи (Drizzle, сырой SQL, миграция)
 * не минует очередь, а очередь на диске — это и есть буфер на случай недоступного склада.
 * Отправкой занимается отдельный процесс-отправитель (`outbox-sender.ts`): движок его не ждёт.
 *
 * Триггеры строятся по текущей схеме (`pragma table_info`), и их подпись хранится рядом:
 * колонка, которую апстрим добавит следующей миграцией, попадает в строку после первой же
 * переустановки — никакой правки здесь не требуется.
 *
 * Строка сессии помечается провайдером своего хода (#562): у разработчика ходы своего
 * провайдера в Buff не уходят — отбирает их отправитель по этой метке. Метка ставится в момент
 * записи: модель сессии позже может смениться, а ход остаётся тем, чем был.
 */

type Db = Database.Interface["db"]

export const TABLE = "buff_outbox"
const META = "buff_outbox_meta"

/** Таблицы, которые очередь не трогает никогда: она сама и её подпись. */
const OWN = new Set([TABLE, META])

/** Строка очереди: таблица, операция, первичный ключ строки (JSON-массив — склад ключует
 *  строку им вместе с файлом-источником, как зеркало) и сама строка (JSON-объект). */
export type Row = {
  seq: number
  tbl: string
  op: "insert" | "update" | "delete"
  key: string
  row: string
  /** Провайдер хода (#562); NULL — строка не из сессии или провайдер неизвестен. */
  provider: string | null
}

/** Версия триггеров: входит в подпись, так что её смена переставляет их у всех установок. */
const VERSION = "2"

const q = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Строка таблицы как JSON: BLOB в JSON не кладётся — он уезжает шестнадцатеричной строкой. */
function jsonOf(alias: "NEW" | "OLD", columns: string[]): string {
  const pairs = columns.map(
    (c) => `'${c.replaceAll("'", "''")}', CASE WHEN typeof(${alias}.${q(c)}) = 'blob' THEN hex(${alias}.${q(c)}) ELSE ${alias}.${q(c)} END`,
  )
  return `json_object(${pairs.join(", ")})`
}

/** Первичный ключ строки как JSON-массив; без первичного ключа — пустой массив. */
function keyOf(alias: "NEW" | "OLD", pk: string[]): string {
  return pk.length ? `json_array(${pk.map((c) => `${alias}.${q(c)}`).join(", ")})` : `json_array()`
}

/** Поле JSON-колонки; не-JSON — NULL, а не ошибка записи. */
const field = (column: string, path: string) =>
  `CASE WHEN json_valid(${column}) THEN json_extract(${column}, '${path}') END`

/** Провайдер сессии: её модель, а без модели — провайдер последнего ответа в ней. */
const sessionProvider = (id: string) =>
  `COALESCE((SELECT ${field("model", "$.providerID")} FROM "session_v2" WHERE id = ${id}), ` +
  `(SELECT ${field("data", "$.model.providerID")} FROM "session_message" WHERE session_id = ${id} AND type = 'assistant' ORDER BY rowid DESC LIMIT 1))`

/** Провайдер хода, к которому относится строка; NULL — строка не из сессии. Удаление строки
 *  сессии с неизвестным провайдером помечено «-»: содержимое такой строки не уходит. */
export function provider(table: string, columns: string[], alias: "NEW" | "OLD"): string {
  const own = (column: string) => `${alias}.${q(column)}`
  const has = (...names: string[]) => names.every((name) => columns.includes(name))
  const known = (...choices: string[]) => `COALESCE(${[...choices, ...(alias === "OLD" ? ["'-'"] : ["NULL"])].join(", ")})`
  if (table === "session_v2" && has("model")) return known(field(own("model"), "$.providerID"))
  if (table === "event" && has("aggregate_id", "data"))
    return (
      `CASE WHEN ${own("aggregate_id")} LIKE 'ses%' THEN ` +
      `${known(field(own("data"), "$.model.providerID"), sessionProvider(own("aggregate_id")))} END`
    )
  if (!has("session_id")) return "NULL"
  const message = table === "session_message" && has("data") ? [field(own("data"), "$.model.providerID")] : []
  return known(...message, sessionProvider(own("session_id")))
}

/** Три триггера таблицы — чистая функция от имени, колонок и ключа, чтобы её можно было проверить. */
export function triggers(table: string, columns: string[], pk: string[]): { name: string; sql: string }[] {
  const insert = `INSERT INTO ${q(TABLE)} (tbl, op, key, row, provider) VALUES ('${table}', `
  return [
    ["insert", "NEW"],
    ["update", "NEW"],
    ["delete", "OLD"],
  ].map(([op, alias]) => ({
    name: `buff_outbox_${table}_${op}`,
    sql:
      `CREATE TRIGGER ${q(`buff_outbox_${table}_${op}`)} AFTER ${op.toUpperCase()} ON ${q(table)} BEGIN ` +
      `${insert}'${op}', ${keyOf(alias as "NEW" | "OLD", pk)}, ${jsonOf(alias as "NEW" | "OLD", columns)}, ` +
      `${provider(table, columns, alias as "NEW" | "OLD")}); END`,
  }))
}

/** Подпись схемы таблицы: триггеры переустанавливаются, когда она меняется. */
export function signature(columns: string[], pk: string[]): string {
  return [`v${VERSION}`, ...columns, "|", ...pk].join("\u001f")
}

export const install = Effect.fn("BuffOutbox.install")(function* (db: Db, options: { skip: ReadonlySet<string> }) {
  yield* db.run(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${q(TABLE)} (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, op TEXT NOT NULL, key TEXT NOT NULL, row TEXT NOT NULL, provider TEXT)`,
    ),
  )
  // Очередь прежней версии: колонки провайдера в ней ещё нет.
  const queue = yield* db.all<{ name: string }>(sql.raw(`SELECT name FROM pragma_table_info(${lit(TABLE)})`))
  if (!queue.some((c) => c.name === "provider"))
    yield* db.run(sql.raw(`ALTER TABLE ${q(TABLE)} ADD COLUMN provider TEXT`))
  yield* db.run(sql.raw(`CREATE TABLE IF NOT EXISTS ${q(META)} (tbl TEXT PRIMARY KEY, signature TEXT NOT NULL)`))
  const tables = (yield* db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ))
    .map((r) => r.name)
    .filter((name) => !OWN.has(name) && !options.skip.has(name))
  const known = new Map(
    (yield* db.all<{ tbl: string; signature: string }>(sql.raw(`SELECT tbl, signature FROM ${q(META)}`))).map((r) => [
      r.tbl,
      r.signature,
    ]),
  )
  for (const table of tables) {
    const info = yield* db.all<{ name: string; pk: number }>(
      sql.raw(`SELECT name, pk FROM pragma_table_info(${lit(table)}) ORDER BY cid`),
    )
    if (!info.length) continue
    const columns = info.map((r) => r.name)
    const pk = info
      .filter((r) => r.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((r) => r.name)
    const sig = signature(columns, pk)
    if (known.get(table) === sig) continue
    for (const t of triggers(table, columns, pk)) {
      yield* db.run(sql.raw(`DROP TRIGGER IF EXISTS ${q(t.name)}`))
      yield* db.run(sql.raw(t.sql))
    }
    yield* db.run(
      sql.raw(
        `INSERT INTO ${q(META)} (tbl, signature) VALUES (${lit(table)}, ${lit(sig)}) ON CONFLICT (tbl) DO UPDATE SET signature = excluded.signature`,
      ),
    )
  }
})

/** Голова очереди — по порядку записи, не больше `limit` строк. */
export const take = Effect.fn("BuffOutbox.take")(function* (db: Db, limit: number) {
  return yield* db.all<Row>(
    sql.raw(`SELECT seq, tbl, op, key, row, provider FROM ${q(TABLE)} ORDER BY seq LIMIT ${Math.max(1, limit | 0)}`),
  )
})

/** Подтверждение доставки: отправленные строки покидают очередь. */
export const ack = Effect.fn("BuffOutbox.ack")(function* (db: Db, seqs: readonly number[]) {
  if (!seqs.length) return
  yield* db.run(sql.raw(`DELETE FROM ${q(TABLE)} WHERE seq IN (${seqs.map((n) => Number(n)).join(", ")})`))
})

function lit(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
