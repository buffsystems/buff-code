// #439: отправитель исходящей очереди — асинхронно, пачками, по порядку, с повтором.
import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { BuffOutbox } from "../../src/buff/outbox"
import { BuffOutboxSender } from "../../src/buff/outbox-sender"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const makeDb = Effect.gen(function* () {
  const db = yield* EffectDrizzleSqlite.makeWithDefaults()
  yield* db.run(sql`create table kv (key text primary key, value text)`)
  yield* BuffOutbox.install(db, { skip: new Set() })
  return db
})

test("пачка уходит одним запросом с источником и контекстом, после ответа очередь пуста", async () => {
  const sent: { url: string; headers: Record<string, string>; body: any }[] = []
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`insert into kv (key, value) values ('a', '1'), ('b', '2')`)
      const result = yield* BuffOutboxSender.flush(db, {
        source: "/development/acme/shop/1/xdg-data/buff/opencode.db",
        sink: { url: "http://api/engine/rows", headers: { "X-Buff-Org": "acme", "X-Service-Token": "t" } },
        batch: 100,
        post: (url, headers, body) => {
          sent.push({ url, headers, body: JSON.parse(body) })
          return Promise.resolve({ ok: true, status: 200 })
        },
      })
      expect(result).toEqual({ sent: 2, delivered: true })
      expect(sent.length).toBe(1)
      expect(sent[0].url).toBe("http://api/engine/rows")
      expect(sent[0].headers["X-Buff-Org"]).toBe("acme")
      expect(sent[0].body.source).toBe("/development/acme/shop/1/xdg-data/buff/opencode.db")
      expect(sent[0].body.rows.map((r: any) => [r.table, r.op, r.key, r.row.key])).toEqual([
        ["kv", "insert", ["a"], "a"],
        ["kv", "insert", ["b"], "b"],
      ])
      expect((yield* BuffOutbox.take(db, 10)).length).toBe(0)
    }),
  )
})

test("отказ склада оставляет строки в очереди — ничего не теряется", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`insert into kv (key, value) values ('a', '1')`)
      const result = yield* BuffOutboxSender.flush(db, {
        source: "/x/opencode.db",
        sink: { url: "http://api/engine/rows", headers: {} },
        batch: 100,
        post: () => Promise.resolve({ ok: false, status: 503 }),
      })
      expect(result).toEqual({ sent: 0, delivered: false })
      expect((yield* BuffOutbox.take(db, 10)).length).toBe(1)
      const thrown = yield* BuffOutboxSender.flush(db, {
        source: "/x/opencode.db",
        sink: { url: "http://api/engine/rows", headers: {} },
        batch: 100,
        post: () => Promise.reject(new Error("сеть")),
      })
      expect(thrown.delivered).toBe(false)
      expect((yield* BuffOutbox.take(db, 10)).length).toBe(1)
    }),
  )
})

test("пустая очередь — запроса нет", async () => {
  let calls = 0
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      const result = yield* BuffOutboxSender.flush(db, {
        source: "/x/opencode.db",
        sink: { url: "http://api/engine/rows", headers: {} },
        batch: 100,
        post: () => {
          calls++
          return Promise.resolve({ ok: true, status: 200 })
        },
      })
      expect(result).toEqual({ sent: 0, delivered: true })
      expect(calls).toBe(0)
    }),
  )
})

test("пауза между попытками растёт после отказа и сбрасывается после доставки", () => {
  expect(BuffOutboxSender.pause({ delivered: true, sent: 5 }, 0)).toBe(0)
  expect(BuffOutboxSender.pause({ delivered: true, sent: 0 }, 0)).toBe(BuffOutboxSender.IDLE_MS)
  const first = BuffOutboxSender.pause({ delivered: false, sent: 0 }, 0)
  const second = BuffOutboxSender.pause({ delivered: false, sent: 0 }, first)
  expect(first).toBeGreaterThan(BuffOutboxSender.IDLE_MS)
  expect(second).toBeGreaterThan(first)
  expect(BuffOutboxSender.pause({ delivered: false, sent: 0 }, 10 ** 9)).toBe(BuffOutboxSender.MAX_PAUSE_MS)
})

test("пачка режется по байтам, строка крупнее лимита едет одна", () => {
  const row = (seq: number, size: number) => ({ seq, tbl: "t", op: "insert" as const, key: "[1]", row: "x".repeat(size), provider: null })
  expect(BuffOutboxSender.fit([row(1, 100), row(2, 100), row(3, 100)], 300).map((r) => r.seq)).toEqual([1])
  expect(BuffOutboxSender.fit([row(1, 100), row(2, 100)], 1000).map((r) => r.seq)).toEqual([1, 2])
  expect(BuffOutboxSender.fit([row(1, 5000), row(2, 10)], 100).map((r) => r.seq)).toEqual([1])
})

test("досылка на закрытии знает приёмник, с которым уже работала, — когда резолверов уже нет", async () => {
  const sent: { url: string; body: any }[] = []
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`insert into kv (key, value) values ('tail', '1')`)
      const source = "/home/ivan/.local/share/buff/opencode.db"
      BuffOutboxSender.remember(source, { url: "https://127.0.0.1:8769/v1/engine/rows", headers: { Authorization: "Bearer t" } })
      yield* BuffOutboxSender.drain(db, {
        source,
        post: async (url, _headers, body) => {
          sent.push({ url, body: JSON.parse(body) })
          return { ok: true, status: 200 }
        },
      })
      const left = yield* db.run(sql`select count(*) as n from buff_outbox`)
      expect(sent.length).toBe(1)
      expect(sent[0].url).toBe("https://127.0.0.1:8769/v1/engine/rows")
      expect(sent[0].body.rows.map((r: any) => r.key)).toEqual([["tail"]])
      expect((left as any)[0].n).toBe(0)
    }),
  )
})
