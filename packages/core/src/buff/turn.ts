export * as BuffTurnPlugin from "./turn.js"

import { Effect } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffTurn } from "@opencode/schema/buff-turn"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { Session } from "../session.js"
import { Snapshot } from "../snapshot.js"
import { BuffLocale } from "./locale.js"

/**
 * Предпросмотр отката (#449). Сам откат в ядре есть, но выполняется молча: файлы на диске
 * переписываются без списка и без проверки. Здесь — что вернёт откат до сообщения человека и
 * какие из этих файлов менялись уже после хода, не агентом: их правки откат затрёт.
 *
 * Считается по тем же снимкам, что и сам откат: файлы шагов после места отката; «менялся после
 * хода» — файл отличается от последнего снимка, который записал агент.
 */
export const register = Effect.fn("BuffTurn.register")(function* (ctx: Context) {
  const sessions = yield* Session.Service
  const snapshots = yield* Snapshot.Service

  const preview = Effect.fnUntraced(function* (input: { sessionID: string; messageID: string }) {
    const history = yield* sessions.messages({ sessionID: SessionID.make(input.sessionID), order: "asc" })
    const at = history.findIndex((message) => message.id === SessionMessage.ID.make(input.messageID))
    if (at === -1) return undefined
    const plan = BuffTurn.plan(history.slice(at))
    const now = yield* snapshots.capture()
    if (!now) return { snapshots: false, files: [] } satisfies BuffTurn.Preview
    if (!plan.files.length || !plan.from || !plan.to) return { snapshots: true, files: [] } satisfies BuffTurn.Preview
    const wanted = new Set<string>(plan.files)
    // Что откат уберёт: разница между состоянием до первого шага и тем, что записал агент.
    const changed = yield* snapshots.diff({
      from: Snapshot.ID.make(plan.from),
      to: Snapshot.ID.make(plan.to),
      context: 0,
    })
    const touched = new Set<string>(yield* snapshots.files({ from: Snapshot.ID.make(plan.to), to: now }))
    const known = new Map(changed.map((item) => [String(item.file), item]))
    return {
      snapshots: true,
      files: plan.files.map((file): BuffTurn.File => {
        const diff = known.get(file)
        return {
          file,
          additions: diff?.additions ?? 0,
          deletions: diff?.deletions ?? 0,
          status: diff?.status ?? "modified",
          external: touched.has(file),
        }
      }),
    } satisfies BuffTurn.Preview
  })

  yield* ctx.rpc
    .register(BuffTurn.Rpc, {
      preview: (input, call) =>
        preview(input).pipe(
          Effect.mapError((cause) => call.error("invalid", cause.message, {}) as never),
          Effect.flatMap((result) =>
            result ? Effect.succeed(result) : Effect.fail(call.error("invalid", BuffLocale.t("Message not found."), {}) as never),
          ),
        ),
    })
    .pipe(Effect.orDie)
})

export const Plugin = define<Session.Service | Snapshot.Service | Scope.Scope>({
  id: "buff.turn",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx)
  }),
})
