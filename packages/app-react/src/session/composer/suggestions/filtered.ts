// A filtered, grouped suggestion list in plain TS (#584): the ranking of the Solid window's
// useFilteredList (fuzzysort over the given keys, groups in a fixed order) for the composer's
// slash commands and @-mentions. Async sources (a file search) publish only their latest answer.

import fuzzysort from "fuzzysort"
import { createStore } from "../../../core/store"

export type FilteredListInput<Item> = {
  items: (query: string) => Item[] | Promise<Item[]>
  filterKeys: string[]
  groupBy?: (item: Item) => string
  groupOrder?: string[]
  /** Items the query never filters out (search results that already matched on the server). */
  skipFilter?: (item: Item) => boolean
}

export function rankItems<Item>(input: Omit<FilteredListInput<Item>, "items">, all: Item[], query: string) {
  const needle = query.toLowerCase()
  const filterable = needle && input.skipFilter ? all.filter((item) => !input.skipFilter?.(item)) : all
  const skipped = needle && input.skipFilter ? all.filter(input.skipFilter) : []
  const matched = needle
    ? [...fuzzysort.go(needle, filterable, { keys: input.filterKeys }).map((result) => result.obj), ...skipped]
    : all
  if (!input.groupBy) return matched
  const groups = new Map<string, Item[]>()
  matched.forEach((item) => {
    const group = input.groupBy?.(item) ?? ""
    groups.set(group, [...(groups.get(group) ?? []), item])
  })
  const order = input.groupOrder ?? []
  return [...groups.entries()]
    .toSorted(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .flatMap(([, items]) => items)
}

export function createFilteredList<Item>(input: FilteredListInput<Item>) {
  const store = createStore<{ query: string; items: Item[] }>({ query: "", items: [] })
  const run = { id: 0 }
  const load = (query: string) => {
    const id = ++run.id
    const items = input.items(query)
    const publish = (all: Item[]) => {
      if (id !== run.id) return
      store.set(() => ({ query, items: rankItems(input, all, query) }))
    }
    if (Array.isArray(items)) return publish(items)
    void items.then(publish, () => publish([]))
  }
  return {
    store,
    items: () => store.get().items,
    filter: (query: string) => load(query),
    /** Re-rank the current query after the sources changed. */
    refresh: () => load(store.get().query),
  }
}

export type FilteredList<Item> = ReturnType<typeof createFilteredList<Item>>
