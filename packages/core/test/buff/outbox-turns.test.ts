// #562: свои провайдеры разработчика. Ход на своей модели в Buff не уходит — строго по ходам:
// даже из смешанной сессии уходят только ходы Buff, а итоги сессии считаются по ним одним.
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
  yield* db.run(
    sql`create table session_v2 (id text primary key, title text, model text, cost real default 0, tokens_input integer default 0, tokens_output integer default 0, tokens_reasoning integer default 0, tokens_cache_read integer default 0, tokens_cache_write integer default 0)`,
  )
  yield* db.run(sql`create table session_message (id text primary key, session_id text, type text, data text)`)
  yield* db.run(sql`create table session_pending (id text primary key, session_id text, data text)`)
  yield* db.run(sql`create table event (id text primary key, aggregate_id text, type text, data text)`)
  yield* db.run(sql`create table kv (key text primary key, value text)`)
  yield* BuffOutbox.install(db, { skip: new Set() })
  return db
})

type Db = Effect.Success<typeof makeDb>

const model = (providerID: string) => JSON.stringify({ id: "m", providerID })
const assistant = (providerID: string, input: number, cost: number) =>
  JSON.stringify({
    model: { id: "m", providerID },
    tokens: { input, output: 1, reasoning: 0, cache: { read: 2, write: 0 } },
    cost,
  })

const session = (db: Db, id: string, providerID: string) =>
  db.run(sql`insert into session_v2 (id, title, model) values (${id}, 'секрет', ${model(providerID)})`)
const message = (db: Db, id: string, sessionID: string, type: string, data: string) =>
  db.run(sql`insert into session_message (id, session_id, type, data) values (${id}, ${sessionID}, ${type}, ${data})`)

const tags = (db: Db) =>
  db.all<{ tbl: string; key: string; provider: string | null }>(sql`select tbl, key, provider from buff_outbox order by seq`)

type Sent = { table: string; op: string; key: unknown; row: Record<string, unknown> }

const flush = (db: Db, onlyBuff: boolean) =>
  Effect.gen(function* () {
    const sent: Sent[] = []
    yield* BuffOutboxSender.flush(db, {
      source: "/x/opencode.db",
      sink: { url: "http://api/engine/rows", headers: {} },
      batch: 100,
      onlyBuff,
      post: (_url, _headers, body) => {
        sent.push(...JSON.parse(body).rows)
        return Promise.resolve({ ok: true, status: 200 })
      },
    })
    return sent
  })

test("строка очереди помечена провайдером своего хода", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* session(db, "ses_a", "buff")
      yield* message(db, "u1", "ses_a", "user", JSON.stringify({ text: "привет" }))
      yield* message(db, "a1", "ses_a", "assistant", assistant("openrouter", 10, 0.1))
      yield* db.run(sql`insert into session_pending (id, session_id, data) values ('p1', 'ses_a', '{}')`)
      yield* db.run(sql`insert into event (id, aggregate_id, type, data) values ('e1', 'ses_a', 'x', '{}')`)
      yield* db.run(
        sql`insert into event (id, aggregate_id, type, data) values ('e2', 'ses_a', 'x', ${JSON.stringify({ model: { providerID: "ollama" } })})`,
      )
      yield* db.run(sql`insert into kv (key, value) values ('k', 'v')`)
      expect((yield* tags(db)).map((r) => [r.tbl, r.provider])).toEqual([
        ["session_v2", "buff"],
        ["session_message", "buff"],
        ["session_message", "openrouter"],
        ["session_pending", "buff"],
        ["event", "buff"],
        ["event", "ollama"],
        ["kv", null],
      ])
    }),
  )
})

test("сессия без модели: ход помечен провайдером последнего ответа, без ответов — неизвестен", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`insert into session_v2 (id) values ('ses_n')`)
      yield* message(db, "u1", "ses_n", "user", "{}")
      yield* message(db, "a1", "ses_n", "assistant", assistant("openrouter", 1, 0))
      yield* message(db, "u2", "ses_n", "user", "{}")
      expect((yield* tags(db)).map((r) => r.provider)).toEqual([null, null, "openrouter", "openrouter"])
    }),
  )
})

test("у разработчика ходы своего провайдера не уходят, а вычёркиваются из очереди", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* session(db, "ses_o", "openrouter")
      yield* message(db, "u1", "ses_o", "user", JSON.stringify({ text: "тайный код" }))
      yield* message(db, "a1", "ses_o", "assistant", assistant("openrouter", 10, 0.1))
      yield* db.run(sql`insert into kv (key, value) values ('k', 'v')`)
      const sent = yield* flush(db, true)
      expect(sent.map((r) => r.table)).toEqual(["kv"])
      expect((yield* BuffOutbox.take(db, 10)).length).toBe(0)
    }),
  )
})

test("удаление строки своего хода уходит одним ключом — без содержимого", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* session(db, "ses_o", "openrouter")
      yield* message(db, "a1", "ses_o", "assistant", assistant("openrouter", 10, 0.1))
      yield* db.run(sql`delete from session_message where id = 'a1'`)
      yield* db.run(sql`delete from session_v2 where id = 'ses_o'`)
      const sent = yield* flush(db, true)
      expect(sent).toEqual([
        { seq: expect.any(Number), table: "session_message", op: "delete", key: ["a1"], row: {} },
        { seq: expect.any(Number), table: "session_v2", op: "delete", key: ["ses_o"], row: {} },
      ] as unknown as Sent[])
    }),
  )
})

test("смешанная сессия: уходят ходы Buff, итоги сессии — только по ним", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* session(db, "ses_m", "buff")
      yield* message(db, "a1", "ses_m", "assistant", assistant("buff", 10, 0.5))
      yield* message(db, "a2", "ses_m", "assistant", assistant("openrouter", 1000, 9))
      yield* message(db, "c1", "ses_m", "compaction", assistant("buff", 5, 0.25))
      yield* db.run(
        sql`update session_v2 set cost = 9.75, tokens_input = 1015, tokens_output = 3, tokens_cache_read = 6 where id = 'ses_m'`,
      )
      const sent = yield* flush(db, true)
      expect(sent.map((r) => [r.table, r.key])).toEqual([
        ["session_v2", ["ses_m"]],
        ["session_message", ["a1"]],
        ["session_message", ["c1"]],
        ["session_v2", ["ses_m"]],
      ])
      expect(sent.at(-1)!.row).toMatchObject({
        id: "ses_m",
        cost: 0.75,
        tokens_input: 15,
        tokens_output: 2,
        tokens_reasoning: 0,
        tokens_cache_read: 4,
        tokens_cache_write: 0,
      })
    }),
  )
})

test("смешанная сессия на своей модели: в Buff уходит последняя модель Buff, а не своя", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* session(db, "ses_m", "buff")
      yield* message(db, "a1", "ses_m", "assistant", assistant("buff", 10, 0.5))
      yield* message(db, "a2", "ses_m", "assistant", assistant("openrouter", 1000, 9))
      yield* db.run(sql`update session_v2 set model = ${JSON.stringify({ id: "qwen-secret", providerID: "openrouter" })} where id = 'ses_m'`)
      const sent = yield* flush(db, true)
      expect(sent.filter((r) => r.table === "session_v2").map((r) => JSON.parse(String(r.row.model)))).toEqual([
        { id: "m", providerID: "buff" },
        { id: "m", providerID: "buff" },
      ])
    }),
  )
})

test("сессию переключили на свою модель до первого её хода: модель в Buff — всё равно Buff", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* session(db, "ses_s", "buff")
      yield* message(db, "a1", "ses_s", "assistant", assistant("buff", 10, 0.5))
      yield* db.run(sql`update session_v2 set model = ${model("ollama")} where id = 'ses_s'`)
      const sent = yield* flush(db, true)
      expect(sent.filter((r) => r.table === "session_v2").map((r) => JSON.parse(String(r.row.model)).providerID)).toEqual([
        "buff",
        "buff",
      ])
    }),
  )
})

test("сессия целиком на своей модели в Buff не попадает; целиком на Buff — уходит как есть", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* session(db, "ses_o", "openrouter")
      yield* session(db, "ses_b", "buff")
      yield* message(db, "a1", "ses_b", "assistant", assistant("buff", 10, 0.5))
      yield* db.run(sql`update session_v2 set cost = 0.6, tokens_input = 12 where id = 'ses_b'`)
      const sent = yield* flush(db, true)
      expect(sent.filter((r) => r.table === "session_v2").map((r) => [r.key, r.row.cost, r.row.tokens_input])).toEqual([
        [["ses_b"], 0, 0],
        [["ses_b"], 0.6, 12],
      ])
    }),
  )
})

test("раннер шлёт всё: его модели — все Buff", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* session(db, "ses_r", "fake")
      yield* message(db, "a1", "ses_r", "assistant", assistant("fake", 10, 0.1))
      const sent = yield* flush(db, false)
      expect(sent.map((r) => r.table)).toEqual(["session_v2", "session_message"])
    }),
  )
})

test("очередь прежней версии получает колонку провайдера и новые триггеры", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* db.run(
        sql`create table buff_outbox (seq integer primary key autoincrement, tbl text not null, op text not null, key text not null, row text not null)`,
      )
      yield* db.run(sql`insert into buff_outbox (tbl, op, key, row) values ('kv', 'insert', '["old"]', '{}')`)
      yield* db.run(sql`create table buff_outbox_meta (tbl text primary key, signature text not null)`)
      yield* db.run(sql`create table session_v2 (id text primary key, model text)`)
      yield* db.run(sql`insert into buff_outbox_meta (tbl, signature) values ('session_v2', ${"id\u001fmodel\u001f|\u001fid"})`)
      yield* BuffOutbox.install(db, { skip: new Set() })
      yield* db.run(sql`insert into session_v2 (id, model) values ('ses_x', ${model("ollama")})`)
      expect((yield* tags(db)).map((r) => [r.tbl, r.provider])).toEqual([
        ["kv", null],
        ["session_v2", "ollama"],
      ])
    }),
  )
})
