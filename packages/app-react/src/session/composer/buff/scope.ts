// Where Buff's strips and chips around the composer look (#584): the server, the workspace
// directory and, in a session, the session.

import { useConnection } from "../../../react/core"
import type { Server } from "../../../core/servers"

export type BuffScope = { server: Server; directory: string; sessionID?: string }

/** The location an RPC call of this scope addresses. */
export const at = (scope: BuffScope) => ({ location: { directory: scope.directory } })

export function useConnected(scope: BuffScope) {
  return useConnection(scope.server).status === "connected"
}
