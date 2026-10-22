import { useSyncExternalStore } from "react"

// The document's writing direction (#584). Radix reads its own context (ltr unless provided), so
// a menu or popover takes this to follow the `dir` the window sets on <html>, as the Solid
// window's Kobalte parts follow the page.
export type Direction = "ltr" | "rtl"

function subscribe(change: () => void) {
  const observer = new MutationObserver(change)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] })
  return () => observer.disconnect()
}

function snapshot(): Direction {
  return document.documentElement.dir === "rtl" ? "rtl" : "ltr"
}

export function useDocumentDirection() {
  return useSyncExternalStore(subscribe, snapshot, () => "ltr" as const)
}
