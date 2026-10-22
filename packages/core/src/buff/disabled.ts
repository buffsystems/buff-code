export * as BuffDisabled from "./disabled.js"

import { Effect } from "effect"
import { BuffShared } from "./shared.js"

/**
 * Выключенное в настройках (#445, #446): навыки, команды, субагенты, файлы памяти, хуки.
 * Список хранится у пользователя, а не в проекте — это его выбор, а не настройка репозитория, —
 * и один на все открытые каталоги: выключенное в настройках проекта выключено и в сессии,
 * идущей в рабочем дереве. `changed` — что сделать, когда список сменился (перечитать реестр).
 */
export const forget = BuffShared.forget

export const make = Effect.fnUntraced(function* (
  storage: BuffShared.Storage,
  key: string,
  changed: Effect.Effect<void>,
) {
  const cell = yield* BuffShared.open<ReadonlySet<string>>({
    storage,
    key,
    decode: (stored) => new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []),
    encode: (ids) => [...ids].toSorted(),
    changed,
  })
  return {
    ids: () => cell.get(),
    has: (id: string) => cell.get().has(id),
    set: (id: string, enabled: boolean) => {
      const next = new Set(cell.get())
      if (enabled) next.delete(id)
      else next.add(id)
      return cell.set(next)
    },
  }
})
