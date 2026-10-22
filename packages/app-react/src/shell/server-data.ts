// Reading a server's data by its key (#584): tabs and routes name servers by key, and a key may
// point at a server no longer in the window — then the read is undefined.

import type { DataState } from "../core/data/state"
import { serverKey } from "../core/servers"
import { createStore } from "../core/store"
import { useCore, useServers } from "../react/core"
import { useStore } from "../react/use-store"

const absent = createStore<DataState | undefined>(undefined)

/** The live controller of the server with this key, if the window has it. */
export function useServerByKey(key: string | undefined) {
  const core = useCore()
  const conn = useServers().find((item) => serverKey(item) === key)
  return conn ? core.registry.ensure(conn) : undefined
}

export function useServerDataByKey<Selected>(
  key: string | undefined,
  select: (state: DataState) => Selected,
  equal?: (previous: Selected, next: Selected) => boolean,
): Selected | undefined {
  const server = useServerByKey(key)
  return useStore<DataState | undefined, Selected | undefined>(
    server?.data.state ?? absent,
    (state) => (state ? select(state) : undefined),
    equal as ((previous: Selected | undefined, next: Selected | undefined) => boolean) | undefined,
  )
}
