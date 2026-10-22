// What every side pane reads about its session (#584): the routed session from the layout, its
// workspace directory and project, the Solid window's session state key (the key its persisted tabs
// and review state live under) and the window-wide pane state.

import { SessionRouteKey, SessionStateKey, type ServerScope } from "@opencode/app/react-reuse/server-scope"
import { base64Encode } from "@opencode/util/encode"
import { useEffect, useMemo } from "react"
import { useI18n } from "../../i18n/provider"
import { useCore, useServerData } from "../../react/core"
import { showToast } from "../../shell/notifications/toast"
import { useSession } from "../context"
import { panesWindow } from "./window"

export function usePanesWindow() {
  const core = useCore()
  return panesWindow(core, (title, description) => showToast({ variant: "error", title, description }))
}

export function usePaneSession() {
  const session = useSession()
  const core = useCore()
  const i18n = useI18n()
  const window = usePanesWindow()
  const server = session.server
  const directory = useServerData(server, (state) => state.session.info[session.sessionID]?.location.directory)
  const projectID = useServerData(server, (state) => state.session.info[session.sessionID]?.projectID)
  const project = useServerData(server, (state) => (projectID ? state.project.info[projectID] : undefined))
  // The project (its name and git state) may not be read yet when a session opens directly.
  useEffect(() => {
    if (!projectID || project) return
    void server.data.project.sync().catch(() => undefined)
  }, [server, projectID, project])
  const sessionKey = useMemo<string | undefined>(() => {
    if (directory === undefined) return
    const scope = core.scope(server.key) as ServerScope
    return SessionStateKey.from(scope, SessionRouteKey.fromRoute(base64Encode(directory), session.sessionID))
  }, [core, server.key, directory, session.sessionID])
  const files = useMemo(() => {
    if (directory === undefined) return
    return window.files(server, directory, {
      load: i18n.t("toast.file.loadFailed.title"),
      list: i18n.t("toast.file.listFailed.title"),
      translate: (key) => i18n.t(key as Parameters<typeof i18n.t>[0]),
    })
  }, [window, server, directory, i18n])
  return { ...session, directory, project, sessionKey, files, window }
}

export type PaneSession = ReturnType<typeof usePaneSession>
