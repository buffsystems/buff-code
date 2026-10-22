export * as BuffTrust from "./trust.js"

import { createHash } from "node:crypto"
import { Effect } from "effect"
import type { Scope } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Rpc } from "@opencode/schema/buff-trust"
import { BuffShared } from "./shared.js"

/**
 * Доверие к хукам и командам проекта (#446). Чужой репозиторий не должен молча запускать
 * команды на машине человека: то, что пришло из проекта, не выполняется, пока человек не
 * посмотрел и не подтвердил. Подтверждение привязано к содержимому: изменилась запись — спросим
 * заново. У рабочих деревьев одного проекта версии могут различаться, поэтому у записи может
 * быть несколько подтверждённых версий. Хранится у пользователя — отпечатки, а не сам текст, —
 * и одно на все открытые каталоги.
 */

/** Отпечаток содержимого: его человек получает вместе с текстом на проверку и возвращает, подтверждая. */
export function token(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

export const forget = BuffShared.forget

/**
 * Проверять ли хуки и команды проекта перед запуском (#457) — общий переключатель человека,
 * его хранит плагин `buff.trust`. Пока не прочитан — проверять: безопасно по умолчанию.
 */
export const ASK_FIRST = "trust-ask-first"

export const askFirst = (storage: BuffShared.Storage, changed: Effect.Effect<void>) =>
  BuffShared.open<boolean>({
    storage,
    key: ASK_FIRST,
    decode: (stored) => stored !== false,
    encode: (value) => value,
    changed,
  })

const unchecked = () => BuffShared.peek<boolean>(ASK_FIRST) === false

type Confirmed = Readonly<Record<string, readonly string[]>>

export const make = Effect.fnUntraced(function* (
  storage: BuffShared.Storage,
  key: string,
  changed: Effect.Effect<void>,
) {
  const cell = yield* BuffShared.open<Confirmed>({
    storage,
    key,
    decode: (stored) =>
      typeof stored === "object" && stored !== null && !Array.isArray(stored)
        ? Object.fromEntries(
            Object.entries(stored).flatMap(([id, value]) =>
              Array.isArray(value) ? [[id, value.filter((item) => typeof item === "string")] as const] : [],
            ),
          )
        : {},
    encode: (confirmed) => Object.fromEntries(Object.entries(confirmed).map(([id, tokens]) => [id, [...tokens]])),
    changed,
  })
  return {
    /** Подтверждено ли это содержимое. */
    ok: (id: string, content: string) => unchecked() || (cell.get()[id] ?? []).includes(token(content)),
    /** Подтвердить просмотренное; `false` — содержимое с тех пор изменилось, подтверждать нечего. */
    confirm: (id: string, content: string, reviewed: string) =>
      Effect.gen(function* () {
        if (token(content) !== reviewed) return false
        const before = cell.get()
        yield* cell.set({ ...before, [id]: [...new Set([...(before[id] ?? []), reviewed])] })
        return true
      }),
    revoke: (id: string) => cell.set(Object.fromEntries(Object.entries(cell.get()).filter(([other]) => other !== id))),
  }
})

/** Плагин переключателя: хранит его у пользователя и отдаёт окну и консоли. */
export const Plugin = define<Scope.Scope>({
  id: "buff.trust",
  effect: Effect.fn(function* (ctx) {
    let changed: Effect.Effect<void> = Effect.void
    const policy = yield* askFirst(
      ctx.storage,
      Effect.suspend(() => changed),
    )
    const registration = yield* ctx.rpc
      .register(Rpc, {
        get: () => Effect.sync(() => ({ askFirst: policy.get() })),
        set: ({ askFirst }) => policy.set(askFirst).pipe(Effect.as({ askFirst })),
      })
      .pipe(Effect.orDie)
    // Значение читается в момент перемены, а не при подписке.
    changed = Effect.suspend(() => registration.events.emit("changed", { askFirst: policy.get() })).pipe(Effect.ignore)
  }),
})
