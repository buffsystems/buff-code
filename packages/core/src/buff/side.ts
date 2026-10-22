export * as BuffSidePlugin from "./side.js"

import { Effect, Schema } from "effect"
import type { Scope } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffSide } from "@opencode/schema/buff-side"
import { KV } from "../kv.js"
import { Session } from "../session.js"
import { SessionSchema } from "../session/schema.js"
import { SideRunner } from "./side/runner.js"
import { BuffLocale } from "./locale.js"

/**
 * Побочный диалог в каталоге (#464): RPC — список и «открыть», событие «открыт», команда
 * `/side [вопрос]`. Сам диалог — ответвление основной сессии (`Session.fork`).
 */

const key = BuffSide.storageKey
const decode = Schema.decodeUnknownOption(Schema.Array(BuffSide.Side))

export const Plugin = define<KV.Service | Session.Service | Scope.Scope>({
  id: "buff.side",
  effect: Effect.fn(function* (ctx) {
    const kv = yield* KV.Service
    const sessions = yield* Session.Service
    const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect as Effect.Effect<A>)
    const id = (session: string) => SessionSchema.ID.make(session)
    const runner = SideRunner.make({
      store: {
        get: (session) =>
          run(kv.get(key(session))).then((value) => {
            const decoded = decode(value)
            return decoded._tag === "Some" ? decoded.value : []
          }),
        put: (session, sides) =>
          run(
            kv.set(
              key(session),
              sides.map((side) => ({ ...side })),
            ),
          ),
      },
      fork: (session) => run(sessions.fork({ sessionID: id(session) })).then((info) => info.id),
      rename: (session, title) => run(sessions.rename({ sessionID: id(session), title })),
      prompt: (session, text) => run(sessions.prompt({ sessionID: id(session), text })).then(() => undefined),
      now: () => Date.now(),
    })

    const registration = yield* ctx.rpc
      .register(BuffSide.Rpc, {
        list: ({ session }) =>
          Effect.promise(() => runner.list(session)).pipe(Effect.map((sides) => ({ sides: [...sides] }))),
        open: ({ session, text }) =>
          Effect.promise(() => runner.open(session, text)).pipe(Effect.map((side) => ({ side }))),
      })
      .pipe(Effect.orDie)
    const opened = (session: string, side: BuffSide.Side) =>
      registration.events.emit("opened", { session, side }).pipe(Effect.ignore)

    yield* ctx.command
      .transform((editor) =>
        editor.add({
          name: "side",
          description: BuffLocale.t("Side conversation: a branch of this session in a tab nearby — the main one does not change"),
          execute: (input) =>
            Effect.promise(() => runner.open(input.sessionID, BuffSide.parse(input.prompt.text).text)).pipe(
              Effect.flatMap((side) => opened(input.sessionID, side)),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
})
