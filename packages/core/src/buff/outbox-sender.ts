export * as BuffOutboxSender from "./outbox-sender.js"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database.js"
import { BuffOutbox } from "./outbox.js"

/**
 * Отправитель исходящей очереди (#439): забирает голову `buff_outbox`, шлёт её в склад одним
 * запросом и после подтверждения вычёркивает отправленное. Работает рядом с движком, но
 * независимо от него: запись в базу его не ждёт, отказ склада его не роняет — строки лежат
 * в очереди до следующей попытки, а пауза между попытками растёт, пока склад не ответит.
 */

type Db = Database.Interface["db"]

/** Куда и с какими заголовками уходят строки; заголовки несут контекст прогона. */
export type Sink = { url: string; headers: Record<string, string> }

export type Post = (url: string, headers: Record<string, string>, body: string) => Promise<{ ok: boolean; status: number }>

export type Outcome = { sent: number; delivered: boolean }

/** Такт ожидания при пустой очереди: строка уходит не позже, чем через него. */
export const IDLE_MS = 200
/** Потолок паузы после отказов склада. */
export const MAX_PAUSE_MS = 30_000
/** Строк в одном запросе. */
export const BATCH = 200
/** Байт полезной нагрузки в одном запросе: по дороге к складу через шину сообщение
 *  ограничено мегабайтом. Строка крупнее лимита едет одна — целиком, не режется. */
export const MAX_BYTES = 512 * 1024

/** Голова пачки, укладывающаяся в лимит байт: хотя бы одна строка всегда. */
export function fit(rows: readonly BuffOutbox.Row[], maxBytes: number): BuffOutbox.Row[] {
  const out: BuffOutbox.Row[] = []
  let size = 0
  for (const r of rows) {
    size += r.row.length + 64
    if (out.length && size > maxBytes) break
    out.push(r)
  }
  return out
}

const BUFF = "buff"

const ofBuff = (provider: string | null) => provider === null || provider === BUFF

type Usage = {
  buff: number | null
  own: number | null
  cost: number | null
  input: number | null
  output: number | null
  reasoning: number | null
  read: number | null
  write: number | null
  model: string | null
}

/** Ходы сессии по провайдерам и расход ходов Buff — по ответам модели и сжатиям в её базе. */
const usage = (db: Db, sessionID: string) =>
  db
    .all<Usage>(
      sql`SELECT SUM(p = ${BUFF}) AS buff, SUM(p <> ${BUFF}) AS own,
        SUM(CASE WHEN p = ${BUFF} THEN json_extract(data, '$.cost') END) AS cost,
        SUM(CASE WHEN p = ${BUFF} THEN json_extract(data, '$.tokens.input') END) AS input,
        SUM(CASE WHEN p = ${BUFF} THEN json_extract(data, '$.tokens.output') END) AS output,
        SUM(CASE WHEN p = ${BUFF} THEN json_extract(data, '$.tokens.reasoning') END) AS reasoning,
        SUM(CASE WHEN p = ${BUFF} THEN json_extract(data, '$.tokens.cache.read') END) AS read,
        SUM(CASE WHEN p = ${BUFF} THEN json_extract(data, '$.tokens.cache.write') END) AS write,
        (SELECT json_object('id', json_extract(data, '$.model.id'), 'providerID', ${BUFF}) FROM session_message
          WHERE session_id = ${sessionID} AND type IN ('assistant', 'compaction') AND json_valid(data)
            AND json_extract(data, '$.model.providerID') = ${BUFF}
          ORDER BY rowid DESC LIMIT 1) AS model
      FROM (SELECT json_extract(data, '$.model.providerID') AS p, data FROM session_message
        WHERE session_id = ${sessionID} AND type IN ('assistant', 'compaction') AND json_valid(data))`,
    )
    .pipe(Effect.map((rows) => rows[0]))

/** Строка сессии для Buff: целиком на Buff — как есть; смешанная — с итогами по ходам Buff и
 *  последней моделью Buff вместо текущей своей;
 *  без единого хода Buff на своей модели — не уходит вовсе (null). */
const sessionRow = Effect.fn("BuffOutboxSender.sessionRow")(function* (db: Db, r: BuffOutbox.Row) {
  const row = parse(r.row) as Record<string, unknown>
  const turns = yield* usage(db, String(row.id))
  if (!turns?.buff) return turns?.own || !ofBuff(r.provider) ? null : r.row
  if (!turns.own && ofBuff(r.provider)) return r.row
  // Сюда попадает и сессия, переключённая на свою модель до первого её хода.
  return JSON.stringify({
    ...row,
    model: turns.model,
    cost: turns.cost ?? 0,
    tokens_input: turns.input ?? 0,
    tokens_output: turns.output ?? 0,
    tokens_reasoning: turns.reasoning ?? 0,
    tokens_cache_read: turns.read ?? 0,
    tokens_cache_write: turns.write ?? 0,
  })
})

/** Что из головы очереди уходит в Buff у разработчика (#562), строго по ходам: строки ходов
 *  своего провайдера остаются дома, их удаление уходит одним ключом — без содержимого. */
export const forBuff = Effect.fn("BuffOutboxSender.forBuff")(function* (db: Db, rows: readonly BuffOutbox.Row[]) {
  const out: BuffOutbox.Row[] = []
  for (const r of rows) {
    if (r.op === "delete") out.push(ofBuff(r.provider) ? r : { ...r, row: "{}" })
    else if (r.tbl === "session_v2") {
      const row = yield* sessionRow(db, r)
      if (row !== null) out.push({ ...r, row })
    } else if (ofBuff(r.provider)) out.push(r)
  }
  return out
})

/** Одна попытка: голова очереди → склад → подтверждение. Чистая по отношению к сети: `post`
 *  передаётся снаружи, так что исход проверяется без сокета. */
export const flush = Effect.fn("BuffOutboxSender.flush")(function* (
  db: Db,
  options: { source: string; sink: Sink; batch: number; post: Post; maxBytes?: number; onlyBuff?: boolean },
) {
  const rows = fit(yield* BuffOutbox.take(db, options.batch), options.maxBytes ?? MAX_BYTES)
  if (!rows.length) return { sent: 0, delivered: true } satisfies Outcome
  const chosen = options.onlyBuff ? yield* forBuff(db, rows) : rows
  const seqs = rows.map((r) => r.seq)
  if (!chosen.length) {
    yield* BuffOutbox.ack(db, seqs)
    return { sent: rows.length, delivered: true } satisfies Outcome
  }
  const body = JSON.stringify({
    source: options.source,
    rows: chosen.map((r) => ({ seq: r.seq, table: r.tbl, op: r.op, key: parse(r.key), row: parse(r.row) })),
  })
  const headers = { "Content-Type": "application/json", ...options.sink.headers }
  const reply = yield* Effect.tryPromise(() => options.post(options.sink.url, headers, body)).pipe(
    Effect.catch(() => Effect.succeed({ ok: false, status: 0 })),
  )
  if (!reply.ok) return { sent: 0, delivered: false } satisfies Outcome
  yield* BuffOutbox.ack(db, seqs)
  return { sent: rows.length, delivered: true } satisfies Outcome
})

/** Пауза до следующей попытки: ноль после непустой доставки (очередь может быть длиннее
 *  пачки), такт ожидания при пустой очереди, растущая пауза после отказа. */
export function pause(outcome: Outcome, previous: number): number {
  if (outcome.delivered) return outcome.sent > 0 ? 0 : IDLE_MS
  return Math.min(MAX_PAUSE_MS, Math.max(IDLE_MS * 5, previous * 2))
}

/** Откуда отправитель узнаёт приёмник: у раннера он задан окружением раз и навсегда; у
 *  разработчика его называет плагин контекста — шлюз коннектора компании, свежий токен
 *  разработчика и выбранные организация и проект, — и он может меняться и пропадать. */
export type Resolve = Effect.Effect<Sink | null>

// Общая на процесс, а не на модуль: сборщик раскладывает ядро по чанкам, и модуль с состоянием
// может оказаться в двух экземплярах — тогда плагин контекста объявил бы приёмник не тому
// отправителю, что ждёт его в слое базы. Плагин контекста — по одному на рабочий каталог, и
// контекст выбран не в каждом: приёмником становится первый, у кого он есть.
const RESOLVERS = Symbol.for("buff.outbox.resolvers")
type Holder = { [RESOLVERS]?: Set<Resolve> }
const holder = globalThis as unknown as Holder
const resolvers = (): Set<Resolve> => (holder[RESOLVERS] ??= new Set())

/** Плагин контекста (developer) объявляет, как найти приёмник; возвращает снятие. */
export function register(resolve: Resolve): () => void {
  resolvers().add(resolve)
  return () => void resolvers().delete(resolve)
}

/** Приёмник, с которым отправитель уже работал, по источнику: на закрытии резолверы плагинов
 *  уже сняты (их область закрывается раньше базы), а досылка хвоста ещё нужна. */
const remembered = new Map<string, Sink>()

export const remember = (source: string, sink: Sink) => remembered.set(source, sink)

const developerSink: Resolve = Effect.gen(function* () {
  for (const resolve of resolvers()) {
    const sink = yield* resolve
    if (sink) return sink
  }
  return null
})

/** Бесконечный цикл отправки — запускается форком в области видимости базы. Без приёмника
 *  цикл только ждёт: строки копятся в очереди до его появления. */
export const loop = Effect.fn("BuffOutboxSender.loop")(function* (
  db: Db,
  options: { source: string; sink?: Sink; onlyBuff?: boolean },
) {
  let wait = 0
  let hadSink = false
  yield* Effect.logInfo("outbox: sender started", { source: options.source, fixed: Boolean(options.sink) })
  while (true) {
    const sink =
      options.sink ??
      (yield* developerSink.pipe(
        Effect.catchCause((cause) => Effect.logWarning("outbox: receiver not found", { cause }).pipe(Effect.as(null))),
      ))
    if (!sink) {
      yield* Effect.sleep(IDLE_MS * 5)
      continue
    }
    if (!hadSink) {
      hadSink = true
      yield* Effect.logInfo("outbox: receiver found", { url: sink.url, source: options.source })
    }
    remember(options.source, sink)
    const outcome = yield* flush(db, { source: options.source, sink, batch: BATCH, post: postJson, onlyBuff: options.onlyBuff }).pipe(
      Effect.catch(() => Effect.succeed({ sent: 0, delivered: false } satisfies Outcome)),
    )
    if (!outcome.delivered) yield* Effect.logWarning("outbox: the warehouse did not accept the batch", { url: sink.url })
    wait = pause(outcome, wait)
    if (wait > 0) yield* Effect.sleep(wait)
  }
})

/** Последняя отправка перед закрытием базы: процесс `buff run` завершается сразу за ответом,
 *  и хвост очереди иначе остался бы ждать следующего запуска. Ограничена по времени и по
 *  попыткам — закрытие не должно зависеть от склада; недоставленное остаётся в очереди. */
export const drain = Effect.fn("BuffOutboxSender.drain")(function* (
  db: Db,
  options: { source: string; sink?: Sink; post?: Post; onlyBuff?: boolean },
) {
  const sink =
    options.sink ??
    (yield* developerSink.pipe(Effect.catch(() => Effect.succeed(null)))) ??
    remembered.get(options.source) ??
    null
  if (!sink) return
  for (let i = 0; i < 20; i++) {
    const outcome = yield* flush(db, {
      source: options.source,
      sink,
      batch: BATCH,
      post: options.post ?? postJson,
      onlyBuff: options.onlyBuff,
    }).pipe(
      Effect.catch(() => Effect.succeed({ sent: 0, delivered: false } satisfies Outcome)),
    )
    if (!outcome.delivered || outcome.sent === 0) return
  }
})

const postJson: Post = async (url, headers, body) => {
  const res = await fetch(url, { method: "POST", headers, body })
  if (!res.ok) console.error(`[outbox] ${url}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`)
  return { ok: res.ok, status: res.status }
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
