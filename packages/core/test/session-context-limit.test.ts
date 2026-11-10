import { describe, expect } from "bun:test"
import { DateTime, Effect, Schema } from "effect"
import { asc, eq, sql } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { EventTable } from "@opencode/core/event/sql"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { testEffect } from "./lib/effect"

// Режимы ИИ (#835, эпик #783): окно контекста сессии — своё событие, столбец и строка в ленте;
// лимит режет окно модели и никогда не поднимает его. Как смена модели (#759), только про окно.
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [Bus.node.replace(Bus.configured({ persist: true })), SessionExecution.node.replace(SessionExecution.noopLayer)],
  ),
)
const sessionID = Session.ID.make("ses_context_limit")

const seed = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: Project.ID.global, slug: "test", directory: "/project", title: "test", version: "test" })
    .run()
  return db
})

describe("Session context limit", () => {
  it.effect("a session may be created with its cap in place", () =>
    Effect.gen(function* () {
      const db = yield* seed
      const sessions = yield* Session.Service
      const created = yield* sessions.create({ location: { directory: AbsolutePath.make("/project") }, limit: { context: 64_000 } })
      expect(created.limit).toEqual({ context: 64_000 })
      expect(
        yield* db.select({ limit: SessionTable.context_limit }).from(SessionTable).where(eq(SessionTable.id, created.id)).get().pipe(Effect.orDie),
      ).toEqual({ limit: 64_000 })
    }),
  )

  it.effect("a cap is projected into the row, the info and a switched message; the same cap is a no-op; undefined clears it", () =>
    Effect.gen(function* () {
      const db = yield* seed
      const sessions = yield* Session.Service
      yield* sessions.switchContext({ sessionID, limit: { context: 200_000 } })
      expect(
        yield* db.select({ limit: SessionTable.context_limit }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie),
      ).toEqual({ limit: 200_000 })
      expect((yield* sessions.get(sessionID)).limit).toEqual({ context: 200_000 })
      yield* sessions.switchContext({ sessionID, limit: { context: 200_000 } })
      yield* sessions.switchContext({ sessionID, limit: undefined })
      expect((yield* sessions.get(sessionID)).limit).toBeUndefined()
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      const messages = rows.map((row) => Schema.decodeUnknownSync(SessionMessage.Info)({ ...row.data, id: row.id, type: row.type }))
      expect(messages.map((m) => m.type)).toEqual(["context-switched", "context-switched"])
      expect(messages[0]).toMatchObject({ limit: { context: 200_000 } })
      expect(messages[1]).toMatchObject({ previous: { context: 200_000 } })
      expect((messages[1] as { limit?: unknown }).limit).toBeUndefined()
      expect(
        yield* db.select({ id: EventTable.id }).from(EventTable).where(sql`${EventTable.type} like 'session.context.selected.%'`).all().pipe(Effect.orDie),
      ).toHaveLength(2)
      // the row's timestamp moves with the change, as for a model switch
      const row = yield* db.select({ updated: SessionTable.time_updated }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
      expect(DateTime.makeUnsafe(row!.updated)).toBeDefined()
    }),
  )
})
