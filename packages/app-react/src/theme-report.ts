import { readStoredTheme } from "@buff/ui/react"

// Spelled out rather than imported: hosts typecheck against this package's declarations and must
// not have to compile the design system's sources.
export type AppliedTheme = { mode: "light" | "dark"; scheme: "light" | "dark" | "system"; background: string }

// @buff/ui paints the theme as `.dark` on <html>; every consumer of useTheme keeps its own state,
// so the host learns about a change by watching the class rather than one hook instance.
export function watchAppliedTheme(onApplied: (theme: AppliedTheme) => void) {
  const root = document.documentElement
  const report = () =>
    onApplied({
      mode: root.classList.contains("dark") ? "dark" : "light",
      scheme: readStoredTheme(),
      background: getComputedStyle(document.body).backgroundColor,
    })
  report()
  const observer = new MutationObserver(report)
  observer.observe(root, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}
