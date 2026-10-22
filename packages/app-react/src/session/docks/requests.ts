// What the routed session is waiting on (#584), ported from the Solid session request model:
// the first permission request and the first question or web-search form across the session and
// its subagents. Either one blocks the composer until it is answered.

import {
  sessionFormRequest,
  sessionPermissionRequest,
  sessionTreeIDs,
} from "@opencode/app/react-reuse/session-request-tree"
import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode/client/promise"
import { useEffect, useMemo } from "react"
import type { DataState } from "../../core/data/state"
import { useConnection, useServerData } from "../../react/core"
import { shallowEqual } from "../../react/use-store"
import { useSettings } from "../../shell/settings-context"
import { useSession } from "../context"

export type SessionRequests = {
  permission?: PermissionRequest
  /** The request came up in a subagent's session. */
  permissionFromSubagent: boolean
  question?: FormInfo
  websearch?: FormInfo
}

/** The pending requests of a session tree, from one data snapshot. */
export function sessionRequests(state: DataState, sessionID: string, autoApprove: boolean): SessionRequests {
  const sessions = Object.values(state.session.info)
  const form = sessionFormRequest(sessions, (id) => state.session.form[id], sessionID)
  const permission = autoApprove
    ? undefined
    : sessionPermissionRequest(sessions, (id) => state.session.permission[id], sessionID)
  const websearch = form?.metadata?.kind === "websearch.provider" ? form : undefined
  return {
    permission,
    permissionFromSubagent: !!permission && permission.sessionID !== sessionID,
    question: !websearch && form?.metadata?.kind === "question" ? form : undefined,
    websearch,
  }
}

export function useSessionRequests(): SessionRequests {
  const { server, sessionID } = useSession()
  const autoApprove = useSettings((settings) => settings.permissions.autoApprove)
  const sessions = useServerData(server, (state) => state.session.info)
  const permissions = useServerData(server, (state) => state.session.permission)
  const forms = useServerData(server, (state) => state.session.form)
  return useMemo(
    () => sessionRequests(server.data.state.get(), sessionID, autoApprove),
    // The slices above key the memo; the snapshot read holds them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [server, sessionID, autoApprove, sessions, permissions, forms],
  )
}

export function useRequestsBlocked() {
  const requests = useSessionRequests()
  return !!requests.permission || !!requests.question || !!requests.websearch
}

/** Load the session tree's permission requests and forms while connected. */
export function useRequestSync() {
  const { server, sessionID } = useSession()
  const connected = useConnection(server).status === "connected"
  const tree = useServerData(
    server,
    (state) => sessionTreeIDs(Object.values(state.session.info) as SessionInfo[], sessionID),
    shallowEqual,
  )
  useEffect(() => {
    if (!connected) return
    void server.data.session.permission.sync(sessionID).catch(() => undefined)
  }, [server, sessionID, connected])
  useEffect(() => {
    if (!connected) return
    tree.forEach((id) => void server.data.session.form.sync(id).catch(() => undefined))
  }, [server, tree, connected])
}
