export * as BuffShared from "./shared.js"

import { Effect, Scope } from "effect"
import type { Schema } from "effect"

/**
 * Выбор пользователя, общий для всех открытых каталогов (#446): что выключено, чему он
 * доверяет. Плагин ядра запускается по разу на каждый каталог — проект, каждое рабочее дерево.
 * Если каждый держит свою копию, то подтверждённое в сессии остаётся «не подтверждённым» в
 * настройках проекта. Поэтому значение одно на процесс, а о перемене узнают все, кто его открыл.
 */

export interface Storage {
  readonly get: (key: string) => Effect.Effect<Schema.Json | undefined>
  readonly set: (key: string, value: Schema.Json) => Effect.Effect<void>
}

interface Cell {
  value: unknown
  readonly listeners: Set<Effect.Effect<void>>
}
const cells = new Map<string, Cell>()

/** Забыть значение в памяти — оно перечитается из хранилища (перезапуск; тесты). */
export function forget(key: string): void {
  cells.delete(key)
}

/** Текущее значение, если его уже кто-то открыл; иначе ничего (#457: чтение без своего хранилища). */
export function peek<A>(key: string): A | undefined {
  return cells.get(key)?.value as A | undefined
}

/**
 * Открыть общее значение. `changed` вызывается у каждого открывшего, когда значение сменил
 * кто угодно, — пока жива область (scope) открывшего.
 */
export const open = Effect.fnUntraced(function* <A>(input: {
  readonly storage: Storage
  readonly key: string
  readonly decode: (stored: Schema.Json | undefined) => A
  readonly encode: (value: A) => Schema.Json
  readonly changed: Effect.Effect<void>
}) {
  const existing = cells.get(input.key)
  const cell: Cell = existing ?? { value: input.decode(yield* input.storage.get(input.key)), listeners: new Set() }
  if (!existing) cells.set(input.key, cell)
  cell.listeners.add(input.changed)
  yield* Scope.addFinalizer(
    yield* Scope.Scope,
    Effect.sync(() => void cell.listeners.delete(input.changed)),
  )
  return {
    get: () => cell.value as A,
    set: (value: A) =>
      Effect.gen(function* () {
        cell.value = value
        yield* input.storage.set(input.key, input.encode(value))
        yield* Effect.forEach([...cell.listeners], (listener) => listener, { discard: true })
      }),
  }
})
