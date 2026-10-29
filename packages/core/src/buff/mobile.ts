export * as BuffMobilePlugin from "./mobile.js"

import { Effect } from "effect"
import type { Scope } from "effect"
import { RefusalError } from "@buff/mobile-protocol"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffMobile } from "@opencode/schema/buff-mobile"
import { BuffMobileService } from "./mobile-service.js"

/**
 * Телефон для Buff Code (#639, #640): RPC для окна и консоли — состояние службы, сопряжение,
 * телефоны. Работу ведёт служба процесса; плагин каталога только передаёт.
 */

export const Plugin = define<BuffMobileService.Service | Scope.Scope>({
  id: "buff.mobile",
  effect: Effect.fn(function* (ctx) {
    const mobile = yield* BuffMobileService.Service
    // Вход в Buff виден отсюда: служба узнаёт по нему дом машины и его политику (#639).
    const signedIn = Effect.gen(function* () {
      const connection = yield* ctx.integration.connection.active("buff")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const connector = (credential?.metadata as { connector?: unknown } | undefined)?.connector
      return credential?.type === "oauth" && typeof connector === "string"
        ? { token: credential.access, connector }
        : undefined
    })
    const unregister = mobile.signIn(() => Effect.runPromise(signedIn))
    yield* Effect.addFinalizer(() => Effect.sync(unregister))
    // Отказ службы — словами человеку; всё остальное — сбой.
    const via = <A>(call: { error: (kind: "refused", message: string, data: {}) => unknown }, body: () => Promise<A> | A) =>
      Effect.tryPromise({ try: async () => body(), catch: (err) => err }).pipe(
        Effect.catch((err) =>
          err instanceof RefusalError ? Effect.fail(call.error("refused", err.message, {}) as never) : Effect.die(err),
        ),
      )

    yield* ctx.rpc
      .register(BuffMobile.Rpc, {
        status: (_input, call) => via(call, () => mobile.status()),
        phones: (_input, call) => via(call, () => mobile.phones()),
        offer: ({ kind }, call) => via(call, () => mobile.offer(kind)),
        view: ({ offerId }, call) => via(call, () => mobile.view(offerId)),
        offers: (_input, call) => via(call, () => mobile.offers()),
        confirm: ({ offerId }, call) => via(call, () => mobile.confirm(offerId)),
        cancel: ({ offerId }, call) => via(call, () => (mobile.cancel(offerId), {})),
        revoke: ({ device }, call) => via(call, () => mobile.revoke(device).then(() => ({}))),
        rename: ({ device, display }, call) => via(call, () => mobile.rename(device, display).then(() => ({}))),
      })
      .pipe(Effect.orDie)
  }),
})
