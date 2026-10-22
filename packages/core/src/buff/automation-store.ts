export * as BuffAutomationStore from "./automation-store.js"

import { Effect, Option, Schema } from "effect"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import type { KV } from "../kv.js"

/**
 * Где лежат автоматизации (#447): в KV службы, общем для всех каталогов и переживающем
 * перезапуск. Каждая автоматизация и каждый запуск — своя запись: история растёт без предела,
 * и запись одного запуска не переписывает всю историю. Последний запуск продублирован в самой
 * автоматизации, чтобы список не обходил истории.
 */

export type Storage = Pick<KV.Interface, "get" | "set" | "remove" | "scan">

export interface Store {
  readonly list: () => Effect.Effect<readonly BuffAutomation.Automation[]>
  readonly get: (id: string) => Effect.Effect<BuffAutomation.Automation | undefined>
  readonly put: (automation: BuffAutomation.Automation) => Effect.Effect<void>
  readonly remove: (id: string) => Effect.Effect<boolean>
  /** Все запуски, новые первыми. */
  readonly runs: (id: string) => Effect.Effect<readonly BuffAutomation.Run[]>
  /** Записать запуск; если он последний у автоматизации (не строка «пропущено») — обновить и её. */
  readonly putRun: (run: BuffAutomation.Run) => Effect.Effect<void>
  readonly removeRun: (id: string, run: string) => Effect.Effect<boolean>
}

const AUTOMATION = "a:"
const runPrefix = (id: string) => `r:${id}:`

const decodeAutomation = Schema.decodeUnknownOption(BuffAutomation.Automation)
const decodeRun = Schema.decodeUnknownOption(BuffAutomation.Run)
const json = (value: unknown) => value as KV.Value

export function make(storage: Storage): Store {
  const scan = (prefix: string): Effect.Effect<readonly KV.Entry[]> => {
    const page = (after: string | undefined): Effect.Effect<readonly KV.Entry[]> =>
      storage
        .scan({ prefix, after })
        .pipe(
          Effect.flatMap((result) =>
            result.next === undefined
              ? Effect.succeed(result.entries)
              : page(result.next).pipe(Effect.map((rest) => [...result.entries, ...rest])),
          ),
        )
    return page(undefined)
  }
  const decoded = <A>(entries: readonly KV.Entry[], decode: (value: unknown) => Option.Option<A>) =>
    entries.flatMap((entry) => Option.toArray(decode(entry.value)))

  const get = (id: string) =>
    storage.get(AUTOMATION + id).pipe(Effect.map((value) => Option.getOrUndefined(decodeAutomation(value))))
  const put = (automation: BuffAutomation.Automation) => storage.set(AUTOMATION + automation.id, json(automation))
  const runs = (id: string) =>
    scan(runPrefix(id)).pipe(Effect.map((entries) => decoded(entries, decodeRun).toReversed()))

  return {
    list: () => scan(AUTOMATION).pipe(Effect.map((entries) => decoded(entries, decodeAutomation))),
    get,
    put,
    remove: (id) =>
      Effect.gen(function* () {
        const found = yield* get(id)
        if (!found) return false
        const keys = (yield* scan(runPrefix(id))).map((entry) => entry.key)
        yield* Effect.forEach(keys, (key) => storage.remove(key), { discard: true })
        yield* storage.remove(AUTOMATION + id)
        return true
      }),
    runs,
    putRun: (run) =>
      Effect.gen(function* () {
        yield* storage.set(runPrefix(run.automation) + run.id, json(run))
        const automation = yield* get(run.automation)
        // Строка «пропущено» — не запуск: карточка показывает последний настоящий запуск.
        const latest = !automation?.last || automation.last.id <= run.id
        if (automation && latest && run.status !== "skipped") yield* put({ ...automation, last: run })
      }),
    removeRun: (id, run) =>
      Effect.gen(function* () {
        const key = runPrefix(id) + run
        if ((yield* storage.get(key)) === undefined) return false
        yield* storage.remove(key)
        const automation = yield* get(id)
        if (automation?.last?.id === run) {
          const { last: _removed, ...rest } = automation
          const [previous] = yield* runs(id)
          yield* put(previous ? { ...rest, last: previous } : rest)
        }
        return true
      }),
  }
}
