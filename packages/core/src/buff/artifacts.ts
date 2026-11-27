export * as BuffArtifactsPlugin from "./artifacts.js"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffArtifacts } from "@opencode/schema/buff-artifacts"
import { Database } from "../database/database.js"
import { SessionMessageTable, SessionTable } from "../session/sql.js"

/**
 * Результаты (#969): файлы, отданные агентом, — из переписки, как поиск (#453). База отбирает
 * ответы, где запись `sent` может быть; сами записи разбирает общее правило
 * (`BuffArtifacts.found`). Только основные чаты: работа субагента — часть хода, а не разговор.
 */

export const register = Effect.fn("BuffArtifacts.register")(function* (ctx: Context) {
  const { db } = yield* Database.Service
  const mark = `%${BuffArtifacts.MARK}%`

  yield* ctx.rpc
    .register(BuffArtifacts.Rpc, {
      list: (input) =>
        Effect.gen(function* () {
          const rows = yield* db
            .select({
              id: SessionMessageTable.id,
              sessionID: SessionMessageTable.session_id,
              time: SessionMessageTable.time_created,
              data: SessionMessageTable.data,
              title: SessionTable.title,
              directory: SessionTable.directory,
            })
            .from(SessionMessageTable)
            .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.session_id))
            .where(
              and(
                isNull(SessionTable.parent_id),
                eq(SessionMessageTable.type, "assistant"),
                sql`${SessionMessageTable.data} LIKE ${mark}`,
                input.sessionID ? sql`${SessionMessageTable.session_id} = ${input.sessionID}` : undefined,
              ),
            )
            .orderBy(desc(SessionMessageTable.time_created))
            .all()
            .pipe(Effect.orDie)
          const items = rows.flatMap((row): BuffArtifacts.Item[] => {
            const directory = row.directory ? String(row.directory) : undefined
            if (input.directories && !BuffArtifacts.under(directory, input.directories)) return []
            if (input.except && BuffArtifacts.under(directory, input.except)) return []
            return BuffArtifacts.found(row.data as object).map((item) => ({
              id: BuffArtifacts.idOf(String(row.id), item),
              sessionID: String(row.sessionID),
              ...(row.title ? { title: row.title } : {}),
              ...(directory ? { directory } : {}),
              file: item.sent.file,
              name: item.sent.name,
              mime: item.sent.mime,
              bytes: item.sent.bytes,
              ...(item.sent.note ? { note: item.sent.note } : {}),
              time: Number(row.time),
            }))
          })
          const from = Math.max(0, input.offset ?? 0)
          const size = Math.max(1, input.limit)
          return {
            items: items.slice(from, from + size),
            ...(from + size < items.length ? { next: from + size } : {}),
          }
        }),
    })
    .pipe(Effect.orDie)
})

export const Plugin = define<Database.Service | Scope.Scope>({
  id: "buff.artifacts",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx)
  }),
})
