// Lazy slot components that can be loaded ahead of time (#584): the session and draft screens'
// slot.tsx files use it, and the window preloads them once idle.

import { createElement, lazy, Suspense, useState, type ComponentType } from "react"

/**
 * A lazy slot component and its preload. Once its module is in, the component renders it
 * directly: React.lazy suspends on its first render even for a loaded module, and React then holds
 * the boundary's reveal back (~300 ms), so a preloaded session screen would still paint empty.
 */
export function lazySlot<Module>(
  load: () => Promise<Module>,
  pick: (module: Module) => ComponentType,
  /** Shown while the module loads (the slot's own boundary otherwise shows nothing). */
  fallback?: ComponentType,
) {
  const loaded: { component?: ComponentType } = {}
  const preload = () =>
    load().then((module) => {
      loaded.component ??= pick(module)
      return module
    })
  const Lazy = lazy(() => preload().then((module) => ({ default: pick(module) })))
  const component: ComponentType = () => {
    // Decided once per mount: a slot that mounted while its module loaded keeps its boundary, so
    // a later render (a reconnect, a setting) does not swap the tree and remount the module.
    const [ready] = useState(() => loaded.component)
    if (ready) return createElement(ready)
    if (!fallback) return createElement(Lazy)
    return createElement(Suspense, { fallback: createElement(fallback) }, createElement(Lazy))
  }
  return { component, preload }
}
