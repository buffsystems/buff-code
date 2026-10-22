import { useSyncExternalStore } from "react"

/** Whether a media query matches, kept current. */
export function useMediaQuery(query: string) {
  const subscribe = (change: () => void) => {
    const list = window.matchMedia(query)
    list.addEventListener("change", change)
    return () => list.removeEventListener("change", change)
  }
  const read = () => window.matchMedia(query).matches
  return useSyncExternalStore(subscribe, read, () => false)
}

export const useMobile = () => useMediaQuery("(max-width: 767px)")
