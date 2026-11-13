// Which sections of the sidebar are folded, kept across restarts (#744): the open tabs' project groups.

import { useEffect, useMemo, useState } from "react"
import { usePlatform } from "../platform/context"

export function useFolded(key: string): [ReadonlySet<string>, (section: string) => void] {
  const platform = usePlatform()
  const store = useMemo(() => platform.storage("buff.sidebar"), [platform])
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    let live = true
    void Promise.resolve(store.getItem(key))
      .then((raw) => {
        if (live && raw) setFolded(new Set(JSON.parse(raw) as string[]))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [store, key])
  const toggle = (section: string) =>
    setFolded((current) => {
      const next = new Set(current)
      if (!next.delete(section)) next.add(section)
      void Promise.resolve(store.setItem(key, JSON.stringify([...next]))).catch(() => undefined)
      return next
    })
  return [folded, toggle]
}
