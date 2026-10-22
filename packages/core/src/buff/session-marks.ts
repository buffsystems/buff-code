export * as BuffSessionMarksPlugin from "./session-marks.js"

import { Effect, Option, Schema } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffSessionMarks } from "@opencode/schema/buff-session-marks"
import { BuffSide } from "@opencode/schema/buff-side"
import { KV } from "../kv.js"
import { BuffShared } from "./shared.js"

/**
 * Отметки сессий (#452): закрепление, архив, группы. Хранятся у пользователя и одни на окно и
 * консоль — поэтому в ядре, а не в хранилище каждого интерфейса. Сессию отметка не меняет:
 * архив — это «убрать с глаз», а не удалить, и возвращается одним действием.
 */

const KEY = "session-marks"

/** Все побочные диалоги (#470) — их ядро хранит по основным сессиям; страница за страницей, без предела. */
const sideIDs = (kv: KV.Interface) =>
  Effect.gen(function* () {
    const kept: unknown[] = []
    let after: string | undefined
    do {
      const page = yield* kv.scan({ prefix: BuffSide.STORAGE_PREFIX, ...(after ? { after } : {}) })
      kept.push(...page.entries.map((entry) => entry.value))
      after = page.next
    } while (after)
    return BuffSide.sideIDs(kept)
  })
const decode = Schema.decodeUnknownOption(BuffSessionMarks.State)

export const register = Effect.fn("BuffSessionMarks.register")(function* (ctx: Context, kv: KV.Interface) {
  let changed: Effect.Effect<void> = Effect.void
  // Значение общее для всех открытых каталогов: сменилось — каждый говорит своим экранам.
  const marks = yield* BuffShared.open<BuffSessionMarks.State>({
    storage: ctx.storage,
    key: KEY,
    decode: (stored) => Option.getOrElse(decode(stored), () => BuffSessionMarks.EMPTY),
    encode: (state) => JSON.parse(JSON.stringify(state)),
    changed: Effect.suspend(() => changed),
  })
  const registration = yield* ctx.rpc
    .register(BuffSessionMarks.Rpc, {
      // Отметки — выбор человека; побочные диалоги к ним приложены, чтобы списки окна и консоли их не показывали.
      get: () => sideIDs(kv).pipe(Effect.map((sides) => ({ ...marks.get(), sides }))),
      change: (input, call) =>
        Effect.gen(function* () {
          const problem = BuffSessionMarks.problem(input, marks.get())
          if (problem) return yield* Effect.fail(call.error("invalid", problem, {}) as never)
          const next = BuffSessionMarks.apply(marks.get(), input)
          yield* marks.set(next)
          return { ...next, sides: yield* sideIDs(kv) }
        }),
    })
    .pipe(Effect.orDie)
  changed = registration.events.emit("changed", {}).pipe(Effect.ignore)
})

export const Plugin = define<KV.Service | Scope.Scope>({
  id: "buff.session-marks",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx, yield* KV.Service)
  }),
})
