import { createStore } from "../core/store"

export type Location = { pathname: string; search: string; hash?: string }

/** Where the window is: the browser's address in a web page, or memory in a desktop window. */
export type History = {
  location: ReturnType<typeof createStore<Location>>
  navigate(to: string, options?: { replace?: boolean }): void
  back(): void
  dispose(): void
}

const parse = (to: string): Location => {
  const url = new URL(to, "http://window")
  return { pathname: url.pathname, search: url.search, ...(url.hash ? { hash: url.hash } : {}) }
}

/** A desktop window keeps its own stack, like the Solid window's memory router. */
export function createMemoryHistory(initial = "/"): History {
  const stack = [initial]
  const location = createStore(parse(initial))
  return {
    location,
    navigate(to, options) {
      if (options?.replace) stack[stack.length - 1] = to
      else stack.push(to)
      location.set(() => parse(to))
    },
    back() {
      if (stack.length < 2) return
      stack.pop()
      location.set(() => parse(stack.at(-1) ?? "/"))
    },
    dispose: () => undefined,
  }
}

export function createBrowserHistory(): History {
  const current = () => ({
    pathname: window.location.pathname,
    search: window.location.search,
    ...(window.location.hash ? { hash: window.location.hash } : {}),
  })
  const location = createStore(current())
  const sync = () => location.set(() => current())
  window.addEventListener("popstate", sync)
  window.addEventListener("hashchange", sync)
  return {
    location,
    navigate(to, options) {
      if (options?.replace) window.history.replaceState(null, "", to)
      else window.history.pushState(null, "", to)
      sync()
    },
    back: () => window.history.back(),
    dispose() {
      window.removeEventListener("popstate", sync)
      window.removeEventListener("hashchange", sync)
    },
  }
}
