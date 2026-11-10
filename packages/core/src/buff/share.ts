export * as BuffSharePlugin from "./share.js"

import { Effect } from "effect"
import type { Scope } from "effect"
import { RefusalError } from "@buff/mobile-protocol"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffShare } from "@opencode/schema/buff-share"
import { BuffShareService } from "./share-service.js"

/**
 * Публичные ссылки (#816): RPC для окна и консоли — список, создание, правка, удаление. Работу
 * ведёт служба процесса; плагин каталога только передаёт.
 */

export const Plugin = define<BuffShareService.Service | Scope.Scope>({
  id: "buff.share",
  effect: Effect.fn(function* (ctx) {
    const shares = yield* BuffShareService.Service
    const via = <A>(
      call: { error: (kind: "refused", message: string, data: {}) => unknown },
      body: () => Promise<A> | A,
    ) =>
      Effect.tryPromise({ try: async () => body(), catch: (err) => err }).pipe(
        Effect.catch((err) =>
          err instanceof RefusalError ? Effect.fail(call.error("refused", err.message, {}) as never) : Effect.die(err),
        ),
      )
    yield* ctx.rpc
      .register(BuffShare.Rpc, {
        status: (_input, call) => via(call, () => shares.status()),
        list: (_input, call) => via(call, () => shares.list()),
        create: (input, call) => via(call, () => shares.create(input)),
        update: ({ id, ...patch }, call) => via(call, () => shares.update(id, patch)),
        remove: ({ id }, call) => via(call, () => shares.remove(id).then(() => ({}))),
      })
      .pipe(Effect.orDie)
  }),
})
