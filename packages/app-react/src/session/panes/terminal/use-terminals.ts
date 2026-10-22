// The routed session's workspace terminals (#584): the workspace's terminal model and, subscribed,
// its PTY list, its first-load flag and the pending focus request.

import { useMemo } from "react"
import { createStore } from "../../../core/store"
import { usePlatform } from "../../../platform/context"
import { useCore, useServerData } from "../../../react/core"
import { useStore } from "../../../react/use-store"
import { useSession } from "../../context"
import { workspaceTerminals } from "./registry"
import { EMPTY_TERMINALS, type TerminalState } from "./state"
import type { FocusRequest } from "./terminals"

const emptyState = createStore<TerminalState>(EMPTY_TERMINALS)
const notReady = createStore(false)
const noFocus = createStore<FocusRequest | undefined>(undefined)
const same = <Value,>(value: Value) => value

export function useWorkspaceTerminals() {
  const session = useSession()
  const core = useCore()
  const platform = usePlatform()
  const directory = useServerData(session.server, (state) => state.session.info[session.sessionID]?.location.directory)
  const terminals = useMemo(() => {
    if (directory === undefined) return
    return workspaceTerminals({ platform, scope: core.scope(session.server.key), server: session.server, directory })
  }, [platform, core, session.server, directory])
  const state = useStore(terminals?.state ?? emptyState, same)
  const ready = useStore(terminals?.ready ?? notReady, same)
  const focus = useStore(terminals?.focus ?? noFocus, same)
  const workspace = directory === undefined ? undefined : `${session.server.key}\n${directory}`
  return { terminals, directory, workspace, state, ready, focus }
}
