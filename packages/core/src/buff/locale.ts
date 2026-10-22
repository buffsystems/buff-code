export * as BuffLocale from "./locale.js"

import { Effect } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { Rpc } from "@opencode/schema/buff-locale"
import { BuffShared } from "./shared.js"

/**
 * Язык Buff (#472): один на окно, консоль и ядро. Окно сообщает язык из своих настроек, консоль
 * читает и слушает его, а строки ядра, которые видит человек (ошибки, команды), переводятся по
 * нему. Пока язык не выбран — русский.
 */

export const KEY = "locale"

/** Открыть общее значение языка; `changed` — у каждого открывшего, когда язык сменили. */
export const open = (storage: BuffShared.Storage, changed: Effect.Effect<void>) =>
  BuffShared.open<BuffI18n.Locale>({
    storage,
    key: KEY,
    decode: (stored) => BuffI18n.locale(typeof stored === "string" ? stored : undefined),
    encode: (locale) => locale,
    changed,
  })

/** Язык для строк ядра: выбранный человеком, а пока никто не открыл — по умолчанию. */
export function current(): BuffI18n.Locale {
  return BuffI18n.locale(BuffShared.peek<string>(KEY))
}

/** Перевести строку ядра на язык человека. */
export const t = (text: string, params?: BuffI18n.Params) => BuffI18n.t(current(), text, params)

export const register = Effect.fn("BuffLocale.register")(function* (ctx: Context) {
  let changed: Effect.Effect<void> = Effect.void
  const locale = yield* open(
    ctx.storage,
    Effect.suspend(() => changed),
  )
  const registration = yield* ctx.rpc
    .register(Rpc, {
      get: () => Effect.sync(() => locale.get()),
      set: (input) => locale.set(input).pipe(Effect.as(input)),
    })
    .pipe(Effect.orDie)
  changed = Effect.suspend(() => registration.events.emit("changed", { locale: locale.get() })).pipe(Effect.ignore)
})

export const Plugin = define<Scope.Scope>({
  id: "buff.locale",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx)
  }),
})
