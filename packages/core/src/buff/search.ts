export * as BuffSearchPlugin from "./search.js"

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffSearch } from "@opencode/schema/buff-search"
import { Database } from "../database/database.js"
import { SessionMessageTable, SessionTable } from "../session/sql.js"
import { BuffLocale } from "./locale.js"

/**
 * Поиск по тексту переписки (#453). Сообщения лежат в базе целиком; база отбирает те, где
 * искомое встречается хоть где-то (в привычных написаниях), а точное совпадение без учёта
 * регистра и фрагмент считаются уже по тексту сообщения — так служебные поля не дают ложных
 * находок. Ищем в основных сессиях: переписка субагента — часть работы, а не разговор.
 */

/**
 * Условие «в сообщении встречается этот текст». Сообщение хранится как JSON, поэтому кавычки и
 * переводы строк в нём записаны с обратной чертой — так же записываем и искомое. Знаки, которые
 * у LIKE значат «что угодно», ищутся как сами знаки.
 */
const contains = (text: string) => {
  const stored = JSON.stringify(text).slice(1, -1)
  const pattern = `%${stored.replace(/[!%_]/g, (sign) => `!${sign}`)}%`
  return sql`${SessionMessageTable.data} LIKE ${pattern} ESCAPE '!'`
}

export const register = Effect.fn("BuffSearch.register")(function* (ctx: Context) {
  const { db } = yield* Database.Service

  const search = Effect.fnUntraced(function* (query: string) {
    const rows = yield* db
      .select({
        id: SessionMessageTable.id,
        sessionID: SessionMessageTable.session_id,
        type: SessionMessageTable.type,
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
          inArray(SessionMessageTable.type, ["user", "assistant"]),
          or(...BuffSearch.variants(query).map(contains)),
        ),
      )
      .orderBy(desc(SessionMessageTable.time_created))
      .all()
      .pipe(Effect.orDie)
    const hits = rows.flatMap((row) => {
      const text = BuffSearch.texts({ ...(row.data as object), type: row.type }).join("\n")
      return text
        ? [
            {
              sessionID: String(row.sessionID),
              title: row.title ?? undefined,
              directory: row.directory ? String(row.directory) : undefined,
              messageID: String(row.id),
              role: row.type === "user" ? ("user" as const) : ("assistant" as const),
              time: Number(row.time),
              text,
            },
          ]
        : []
    })
    return BuffSearch.results(hits, query)
  })

  yield* ctx.rpc
    .register(BuffSearch.Rpc, {
      sessions: (input, call) => {
        const problem = BuffSearch.problem(input.query)
        return problem ? Effect.fail(call.error("invalid", BuffLocale.t(problem), {}) as never) : search(input.query)
      },
    })
    .pipe(Effect.orDie)
})

export const Plugin = define<Database.Service | Scope.Scope>({
  id: "buff.search",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx)
  }),
})
