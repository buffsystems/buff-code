// Хранилище «ключ — значение» в памяти для тестов: обход по префиксу страницами, как у KV.
import { Effect } from "effect"
import type { KV } from "../../src/kv"

export function fakeKV(page = 2): KV.Interface & { readonly data: Map<string, KV.Value> } {
  const data = new Map<string, KV.Value>()
  return {
    data,
    get: (key) => Effect.sync(() => data.get(key)),
    set: (key, value) => Effect.sync(() => void data.set(key, value)),
    remove: (key) => Effect.sync(() => void data.delete(key)),
    scan: (options) =>
      Effect.sync(() => {
        const keys = [...data.keys()]
          .filter((key) => key.startsWith(options.prefix) && (options.after === undefined || key > options.after))
          .sort()
        const size = Math.min(options.limit ?? page, page)
        const entries = keys.slice(0, size).map((key) => ({ key, value: data.get(key)! }))
        return keys.length > size ? { entries, next: entries[entries.length - 1]!.key } : { entries }
      }),
  }
}
