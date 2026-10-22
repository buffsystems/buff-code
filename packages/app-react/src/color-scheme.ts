// The painted mode as `data-color-scheme` on <html> (#584), the attribute the Solid window's theme
// sets and its dark-only rules and the e2e specs read. @buff/ui paints the mode as `.dark`, so the
// attribute follows that class through light, dark and system alike.

export function followColorScheme(root: HTMLElement) {
  const sync = () => {
    const scheme = root.classList.contains("dark") ? "dark" : "light"
    if (root.dataset.colorScheme !== scheme) root.dataset.colorScheme = scheme
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(root, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}
