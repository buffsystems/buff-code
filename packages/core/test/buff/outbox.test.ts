// #439: сквозная запись. Каждая запись движка в свою базу дублируется строкой исходящей
// очереди — триггером, в той же транзакции, — а уходит в склад отдельно и асинхронно.
import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { BuffOutbox } from "../../src/buff/outbox"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const makeDb = Effect.gen(function* () {
  const db = yield* EffectDrizzleSqlite.makeWithDefaults()
  yield* db.run(sql`create table session_v2 (id text primary key, title text, cost real, time_updated integer)`)
  yield* db.run(sql`create table credential (id text primary key, secret text)`)
  return db
})

type Db = Effect.Success<ReturnType<typeof EffectDrizzleSqlite.makeWithDefaults>>
const rows = (db: Db) =>
  db.all<{ seq: number; tbl: string; op: string; key: string; row: string }>(
    sql`select seq, tbl, op, key, row from buff_outbox order by seq`,
  )

test("вставка, изменение и удаление строки — три строки очереди с полной строкой", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* BuffOutbox.install(db, { skip: new Set() })
      yield* db.run(sql`insert into session_v2 (id, title, cost, time_updated) values ('s1', 'первая', 0, 1)`)
      yield* db.run(sql`update session_v2 set cost = 0.5, time_updated = 2 where id = 's1'`)
      yield* db.run(sql`delete from session_v2 where id = 's1'`)
      const out = yield* rows(db)
      expect(out.map((r) => [r.tbl, r.op])).toEqual([
        ["session_v2", "insert"],
        ["session_v2", "update"],
        ["session_v2", "delete"],
      ])
      expect(JSON.parse(out[0].row)).toEqual({ id: "s1", title: "первая", cost: 0, time_updated: 1 })
      expect(out.map((r) => JSON.parse(r.key))).toEqual([["s1"], ["s1"], ["s1"]])
      expect(JSON.parse(out[1].row)).toEqual({ id: "s1", title: "первая", cost: 0.5, time_updated: 2 })
      expect(JSON.parse(out[2].row)).toEqual({ id: "s1", title: "первая", cost: 0.5, time_updated: 2 })
    }),
  )
})

test("таблицы из списка исключений не дублируются (учётные данные разработчика)", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* BuffOutbox.install(db, { skip: new Set(["credential"]) })
      yield* db.run(sql`insert into credential (id, secret) values ('c1', 'тайна')`)
      yield* db.run(sql`insert into session_v2 (id) values ('s2')`)
      const out = yield* rows(db)
      expect(out.map((r) => r.tbl)).toEqual(["session_v2"])
    }),
  )
})

test("очередь сама себя не дублирует и переживает повторную установку", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* BuffOutbox.install(db, { skip: new Set() })
      yield* BuffOutbox.install(db, { skip: new Set() })
      yield* db.run(sql`insert into session_v2 (id) values ('s3')`)
      const out = yield* rows(db)
      expect(out.length).toBe(1)
    }),
  )
})

test("новая колонка апстрима попадает в строку после переустановки триггеров", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* BuffOutbox.install(db, { skip: new Set() })
      yield* db.run(sql`alter table session_v2 add column agent text`)
      yield* BuffOutbox.install(db, { skip: new Set() })
      yield* db.run(sql`insert into session_v2 (id, agent) values ('s4', 'build')`)
      const out = yield* rows(db)
      expect(JSON.parse(out[0].row).agent).toBe("build")
    }),
  )
})

test("отправленное удаляется из очереди по номерам, остальное остаётся", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* BuffOutbox.install(db, { skip: new Set() })
      yield* db.run(sql`insert into session_v2 (id) values ('a'), ('b'), ('c')`)
      const batch = yield* BuffOutbox.take(db, 2)
      expect(batch.map((r) => JSON.parse(r.row).id)).toEqual(["a", "b"])
      yield* BuffOutbox.ack(db, batch.map((r) => r.seq))
      const rest = yield* BuffOutbox.take(db, 10)
      expect(rest.map((r) => JSON.parse(r.row).id)).toEqual(["c"])
    }),
  )
})

test("составной первичный ключ — массив из всех его колонок по порядку", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`create table worktree (project_id text, directory text, note text, primary key (project_id, directory))`)
      yield* BuffOutbox.install(db, { skip: new Set() })
      yield* db.run(sql`insert into worktree (project_id, directory, note) values ('p', '/d', 'n')`)
      const out = (yield* rows(db)).filter((r) => r.tbl === "worktree")
      expect(JSON.parse(out[0].key)).toEqual(["p", "/d"])
    }),
  )
})
