export * as Database from "./database.js"

import { EffectDrizzleSqlite } from "./drizzle.js"
import { sqliteLayer, supportsForeignKeyToggle, supportsTuningPragmas } from "#sqlite"
import { Context, Effect, Layer, Schedule, Schema, Semaphore } from "effect"
import type { SqlClient } from "effect/unstable/sql"
import { Global } from "@opencode/util/global"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { runID } from "@opencode/util/observability/shared"
import { BuffGitSeen } from "../buff/gitseen.js"
import { BuffJournal } from "../buff/journal.js"
import { BuffOutbox } from "../buff/outbox.js"
import { BuffOutboxSender } from "../buff/outbox-sender.js"
import { BuffRunnerMode } from "../buff/runner.js"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export const Options = Schema.Struct({
  path: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/storage/Database") {}

// The bootstrap lock is scoped to the database being built, never to this
// module: on workerd every Durable Object in an isolate shares module state, and
// releasing a shared semaphore resumes the waiting object's fiber inside the
// releasing object's I/O context, where its first storage call is rejected as
// cross-object I/O.
// Buff (#439): у разработчика его учётные данные в склад не уезжают; у раннера — все таблицы.
const DEVELOPER_PRIVATE = new Set(["credential", "account", "account_state", "control_account"])

const databaseLayer = (lock: Effect.Effect<Semaphore.Semaphore>, source?: string) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const db = yield* makeDatabase

      if (supportsTuningPragmas) {
        yield* db.run("PRAGMA journal_mode = WAL")
        yield* db.run("PRAGMA synchronous = NORMAL")
        yield* db.run("PRAGMA busy_timeout = 5000")
        yield* db.run("PRAGMA cache_size = -64000")
        yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
      }
      // Durable Object SQLite always enforces foreign keys and rejects the pragma.
      if (supportsForeignKeyToggle) yield* db.run("PRAGMA foreign_keys = ON")
      const semaphore = yield* lock
      yield* semaphore.withPermit(DatabaseMigration.apply(db))
      // Сквозная запись (#439): триггеры очереди ставятся сразу за миграциями — раньше
      // первой записи приложения; отправитель живёт, пока жива база, и её не задерживает.
      // Вердикт git по правкам (#245) — своя таблица движка, заведённая ДО триггеров очереди,
      // чтобы и она дублировалась в склад.
      yield* semaphore.withPermit(BuffGitSeen.install(db))
      BuffGitSeen.attach(db)
      // Журнал движка (#538) — тоже своя таблица до триггеров очереди: склад получает его
      // строками базы, а не чтением файла с общего диска.
      yield* semaphore.withPermit(BuffJournal.install(db))
      yield* semaphore.withPermit(
        BuffOutbox.install(db, { skip: BuffRunnerMode.active() ? new Set() : DEVELOPER_PRIVATE }),
      )
      // Приёмник: у раннера — из окружения; у разработчика его назовёт плагин контекста
      // (шлюз коннектора), а до тех пор строки ждут в очереди.
      // Ходы своего провайдера разработчика (#562) в Buff не уходят; у раннера все модели — Buff.
      const sink = BuffRunnerMode.sink() ?? undefined
      const onlyBuff = !BuffRunnerMode.active()
      if (source && (sink || onlyBuff)) {
        yield* Effect.addFinalizer(() =>
          BuffOutboxSender.drain(db, { source, sink, onlyBuff }).pipe(Effect.timeout("5 seconds"), Effect.ignore),
        )
        yield* Effect.forkScoped(BuffOutboxSender.loop(db, { source, sink, onlyBuff }))
        // Финализаторы идут в обратном порядке: последний перенос журнала — раньше досылки
        // хвоста очереди, чтобы и он успел уехать.
        if (BuffRunnerMode.active()) {
          yield* Effect.addFinalizer(() => BuffJournal.flush(db, runID()).pipe(Effect.ignore))
          yield* Effect.forkScoped(
            BuffJournal.flush(db, runID()).pipe(Effect.ignore, Effect.repeat(Schedule.spaced(BuffJournal.INTERVAL))),
          )
        }
      }

      return { db }
    }).pipe(Effect.orDie),
  )

// Two instances over one file bootstrap the same schema, so file databases
// share a lock per path. Each in-memory database is its own connection.
const locks = new Map<string, Semaphore.Semaphore>()

function lockFor(filename: string) {
  const existing = locks.get(filename)
  if (existing) return existing
  const lock = Semaphore.makeUnsafe(1)
  locks.set(filename, lock)
  return lock
}

export function layer(options: Options = { path: ":memory:" }) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const provide = (filename: string) =>
        databaseLayer(
          filename === ":memory:" ? Semaphore.make(1) : Effect.succeed(lockFor(filename)),
          filename === ":memory:" ? undefined : filename,
        ).pipe(Layer.provide(sqliteLayer({ filename })))
      const filename = options.path ?? ":memory:"
      if (filename === ":memory:" || isAbsolute(filename)) return provide(filename)
      const global = yield* Global.Service
      return provide(join(global.data, filename))
    }),
  )
}

// The database service over an injected SqlClient, for runtimes that receive
// database storage instead of opening a filesystem path. Any client provided
// here still goes through the pragma guards and migrations; Global is required
// because migrations may read it (the v1 import). The lock is created per build
// because every Durable Object builds this layer over its own storage.
export const layerFromClient: Layer.Layer<Service, never, SqlClient.SqlClient | Global.Service> = databaseLayer(
  Semaphore.make(1),
)

export function configured(options?: Options) {
  return makeGlobalNode({ service: Service, layer: layer(options), deps: [Global.node] })
}

/** `configured`, but over an injected SqlClient layer instead of a filesystem path. */
export function configuredClient(client: Layer.Layer<SqlClient.SqlClient>) {
  return makeGlobalNode({
    service: Service,
    layer: layerFromClient.pipe(Layer.provide(client)),
    deps: [Global.node],
  })
}

export const node = configured({ path: ":memory:" })
