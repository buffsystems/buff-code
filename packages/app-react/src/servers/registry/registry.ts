// The window's server list as the settings and dialogs change it (#584), ported from the Solid
// window's ServersProvider (add, remove, hide) and registry/management.ts (replace): stored HTTP
// servers live in opencode.global.dat:server, the same list both windows read.

import type { ServerState } from "../../core/server-state"
import { serverKey, type ServerConnection } from "../../core/servers"

type Http = Extract<ServerConnection, { type: "http" }>

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

/** The desktop's own server: never edited, removed only by hiding. */
export const builtinServer = (conn: ServerConnection) => conn.type === "sidecar" && conn.variant === "base"

export function createServerRegistryActions(input: { state: ServerState; provided: readonly ServerConnection[] }) {
  const stored = () => input.state.store.get().list
  const add = (conn: Http): Http | undefined => {
    const url = normalizeServerUrl(conn.http.url)
    if (!url) return undefined
    const next: Http = { ...conn, authToken: undefined, http: { ...conn.http, url } }
    input.state.set((state) => {
      const index = state.list.findIndex((item) => item.http.url === url)
      const list = index === -1 ? [...state.list, next] : state.list.with(index, next)
      return { ...state, list }
    })
    return next
  }
  const remove = (key: string) =>
    input.state.set((state) => ({ ...state, list: state.list.filter((item) => item.http.url !== key) }))
  return {
    add,
    remove,
    /** Only a server the person added can be removed; servers the host provides stay. */
    canRemove: (key: string) =>
      !input.provided.some((conn) => serverKey(conn) === key) && stored().some((item) => item.http.url === key),
    isHidden: (key: string) => input.state.store.get().hidden[key] ?? false,
    setHidden: (key: string, hidden: boolean) =>
      input.state.set((state) => ({ ...state, hidden: { ...state.hidden, [key]: hidden } })),
    /** An edit that changed the address: the new server first, then the old one goes. */
    replace(originalKey: string, next: Http) {
      if (!add(next)) return
      remove(originalKey)
    },
  }
}

export type ServerRegistryActions = ReturnType<typeof createServerRegistryActions>
