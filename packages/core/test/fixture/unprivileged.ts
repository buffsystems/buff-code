import { Effect } from "effect"

/**
 * Права каталога root не останавливают: под root `chmod 0500` не делает каталог недоступным
 * для записи, и проверка «каталог закрыт» проходила бы мимо. Под root действие выполняется
 * с эффективным пользователем nobody, затем права возвращаются; у обычного пользователя —
 * как есть.
 */
const NOBODY = 65534

function drop(): boolean {
  if (process.platform === "win32" || process.geteuid?.() !== 0) return false
  process.seteuid!(NOBODY)
  return true
}

function restore(dropped: boolean): void {
  if (dropped) process.seteuid!(0)
}

export async function asUnprivileged<T>(fn: () => Promise<T>): Promise<T> {
  const dropped = drop()
  try {
    return await fn()
  } finally {
    restore(dropped)
  }
}

export function unprivileged<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(drop),
    () => effect,
    (dropped) => Effect.sync(() => restore(dropped)),
  )
}
