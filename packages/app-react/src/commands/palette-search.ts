// The palette's search (#584), the Solid createCommandPaletteSearch as a hook: local entries at
// once, each remote source's results appended as they arrive — only for the current query, a
// newer query aborting the older one.

import { useEffect, useState } from "react"
import { uniqueEntries, type PaletteEntry, type PaletteSource } from "./palette-entries"

type Result = { query: string; items: PaletteEntry[]; loading: boolean }

export function usePaletteSearch(input: {
  query: string
  items: (query: string) => PaletteEntry[]
  sources: PaletteSource[]
}) {
  const query = input.query.trim()
  const [results, setResults] = useState<Result[]>(() =>
    input.sources.map(() => ({ query: "", items: [], loading: false })),
  )

  useEffect(() => {
    const controller = new AbortController()
    setResults((current) => current.map((result) => ({ ...result, loading: true })))
    input.sources.forEach((load, index) => {
      void load(query, controller.signal)
        .catch(() => [])
        .then((items) => {
          if (controller.signal.aborted) return
          setResults((current) =>
            current.map((result, at) => (at === index ? { query, items, loading: false } : result)),
          )
        })
    })
    return () => controller.abort()
  }, [query, input.sources])

  const remote = results.flatMap((result) => (result.query === query ? result.items : []))
  const items = uniqueEntries([...input.items(query), ...remote])
  return { items, loading: results.some((result) => result.loading) }
}
