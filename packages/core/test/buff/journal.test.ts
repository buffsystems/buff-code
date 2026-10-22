// #538: журнал движка едет в склад строками своей базы (`buff_log`) той же очередью сквозной
// записи — склад не читает файл журнала с общего диска.
import { beforeEach, expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { LogJournal } from "@opencode/util/observability/journal"
import { BuffJournal } from "../../src/buff/journal"
import { BuffOutbox } from "../../src/buff/outbox"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

beforeEach(() => {
  LogJournal.take()
})

test("строки режутся на части по пределу байт, ни одна строка не делится", () => {
  expect(BuffJournal.chunks(["aaaa", "bbbb", "cc"], 10)).toEqual(["aaaa\nbbbb", "cc"])
  expect(BuffJournal.chunks(["x".repeat(20)], 10)).toEqual(["x".repeat(20)])
  expect(BuffJournal.chunks([], 10)).toEqual([])
})

test("накопленное ложится частями с номером и запуском и уезжает очередью", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* BuffJournal.install(db)
      yield* BuffOutbox.install(db, { skip: new Set() })
      LogJournal.push("level=INFO message=one")
      LogJournal.push("level=INFO message=two")
      yield* BuffJournal.flush(db, "run1")
      yield* BuffJournal.flush(db, "run1")
      const rows = yield* db.all<{ id: number; run: string; chunk: string }>(sql`select id, run, chunk from buff_log`)
      expect(rows).toEqual([{ id: 1, run: "run1", chunk: "level=INFO message=one\nlevel=INFO message=two" }])
      const queued = yield* db.all<{ tbl: string }>(sql`select tbl from buff_outbox`)
      expect(queued.map((r) => r.tbl)).toEqual(["buff_log"])
    }),
  )
})

test("вытесненные из накопителя строки отмечены в журнале, а не пропадают молча", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* BuffJournal.install(db)
      LogJournal.push("старая", 8)
      LogJournal.push("новая", 8)
      yield* BuffJournal.flush(db, "run1")
      const rows = yield* db.all<{ chunk: string }>(sql`select chunk from buff_log`)
      expect(rows[0].chunk).toBe("[buff] journal: 1 line(s) dropped before delivery\nновая")
    }),
  )
})
