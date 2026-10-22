// What a tab shows about its session family (#584): working while any member runs, and a mark
// while a permission or a question waits for an answer (which stops the working indicator).

import { sessionFormRequest, sessionPermissionRequest } from "@opencode/app/react-reuse/session-request-tree"
import type { DataState } from "../../core/data/state"
import type { Server } from "../../core/servers"
import { useServerData } from "../../react/core"
import { shallowEqual } from "../../react/use-store"

export function sessionActivity(state: DataState, sessionID: string) {
  const root = state.session.info[sessionID]
  const family = [...new Set([sessionID, ...(state.session.family[sessionID] ?? [])])].flatMap((id) => {
    const info = state.session.info[id]
    return info ? [info] : []
  })
  const sessions = root ? family : []
  const attention =
    !!sessionPermissionRequest(sessions, state.session.permission, sessionID) ||
    !!sessionFormRequest(sessions, state.session.form, sessionID)
  const ids = family.length > 0 ? family.map((item) => item.id) : [sessionID]
  const working = !attention && ids.some((id) => state.session.active[id] === "running")
  return { working, unread: attention }
}

export function useSessionActivity(server: Server, sessionID: string) {
  return useServerData(server, (state) => sessionActivity(state, sessionID), shallowEqual)
}
