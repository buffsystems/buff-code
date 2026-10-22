import type { OpenCodeClient } from "@opencode/client/promise"

type Handler = (...args: never[]) => unknown
type Call = { path: string; input: unknown }

/**
 * A server API for tests: `routes` maps a dotted client path ("session.get") to its handler. Every
 * call is recorded; a call without a route rejects, so a test sees any read it did not expect.
 */
export function fakeApi(routes: Record<string, Handler>): {
  api: OpenCodeClient
  calls: Call[]
  called: (path: string) => Call[]
} {
  const calls: Call[] = []
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_, key) => (typeof key === "string" ? node([...path, key]) : undefined),
      apply: (_, __, args: unknown[]) => {
        const name = path.join(".")
        calls.push({ path: name, input: args[0] })
        const route = routes[name]
        if (!route) return Promise.reject(new Error(`unexpected call ${name}`))
        return Promise.resolve((route as (...input: unknown[]) => unknown)(...args))
      },
    })
  return {
    api: node([]) as OpenCodeClient,
    calls,
    called: (path: string) => calls.filter((call) => call.path === path),
  }
}
