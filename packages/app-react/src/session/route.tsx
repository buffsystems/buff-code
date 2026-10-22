// The route frame of /server/:serverKey/session/:id (#584): finds the routed server, starts the
// session's sync and renders the layout with the registered slots. A session still being prepared
// (its new worktree first) shows the same layout over its staged first prompt, marked
// session-preparing, and is not read from the server until it exists. A session that is gone
// (deleted while shown, or unknown to the server) shows the Solid window's not-found fallback.

import { Button, EmptyState } from "@buff/ui/react"
import { isSessionNotFoundError } from "@opencode/app/react-reuse/server-errors"
import { X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useDialog } from "../dialog/dialogs"
import { serverKey, serverName } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { useConnection, useServer, useServers } from "../react/core"
import { useStore } from "../react/use-store"
import { sessionHref } from "../router/routes"
import { useNavigate } from "../router/router"
import { useCurrentTab, useTabs } from "../shell/tabs/provider"
import { findSessionTab, tabKey, tabServer } from "../shell/tabs/tabs"
import { SessionProvider } from "./context"
import { SessionLayout } from "./layout"
import { useSessionLocation } from "./location"
import { registeredSlots } from "./registered"
import type { SessionSlots } from "./slots"
import type { Server, ServerConnection } from "../core/servers"

export function SessionRoute(props: { serverKey: string; sessionID: string; slots?: SessionSlots }) {
  const conn = useServers().find((item) => serverKey(item) === props.serverKey)
  if (!conn) return null
  return <SessionScreen conn={conn} sessionID={props.sessionID} slots={props.slots ?? registeredSlots} />
}

function SessionScreen(props: { conn: ServerConnection; sessionID: string; slots: SessionSlots }) {
  const server = useServer(props.conn)
  const tab = useCurrentTab()
  const tabs = useTabs()
  const viewKey = tab ? tabKey(tab) : undefined
  const pendingKey = tabKey({ type: "session", server: tabServer(server.key), sessionId: props.sessionID })
  const pending = useStore(tabs.pending, (all) => !!all[pendingKey])
  const missing = useMissingSession(server, props.sessionID, pending)
  useEscapeToParent(server, props.sessionID)
  const value = useMemo(
    () => ({ conn: props.conn, server, serverKey: server.key, sessionID: props.sessionID, viewKey }),
    [props.conn, server, props.sessionID, viewKey],
  )
  const connected = useConnection(server).status === "connected"
  // Read again after a reconnect: the cached reads went stale while the events were missed.
  useEffect(() => {
    if (pending || !connected) return
    void server.data.session.sync(props.sessionID).catch(() => undefined)
    void server.data.session.message.sync(props.sessionID).catch(() => undefined)
    void server.data.session.pending.sync(props.sessionID).catch(() => undefined)
  }, [server, props.sessionID, pending, connected])
  const location = useSessionLocation({ server, sessionID: props.sessionID, enabled: !pending })
  const workspace = pending || location.workspace
  if (missing) return <SessionNotFound conn={props.conn} sessionID={props.sessionID} />
  // The wrapper stays across the handoff, so the layout under it is not remounted.
  return (
    <div
      data-component={pending ? "session-preparing" : undefined}
      data-workspace-session={workspace ? "" : undefined}
      data-local-session={workspace ? undefined : ""}
      className="contents"
    >
      <SessionProvider value={value}>
        <SessionLayout slots={props.slots} />
      </SessionProvider>
    </div>
  )
}

/** Syncs the routed session; true once the server says it does not exist or it is deleted. */
function useMissingSession(server: Server, sessionID: string, pending: boolean) {
  const [missing, setMissing] = useState<string>()
  useEffect(() => {
    if (pending) return
    const current = { live: true }
    // With its children, as the Solid route resolves it: a cached session is read again once.
    void server.data.session.sync(sessionID, { children: true }).catch((error: unknown) => {
      if (current.live && isSessionNotFoundError(error, sessionID)) setMissing(sessionID)
    })
    const stop = server.event.on("session.deleted", (event) => {
      if (event.data.sessionID === sessionID) setMissing(sessionID)
    })
    return () => {
      current.live = false
      stop()
    }
  }, [server, sessionID, pending])
  return missing === sessionID
}

/** Esc on a subagent session (focus outside any field or dialog) goes back to its parent. */
function useEscapeToParent(server: Server, sessionID: string) {
  const navigate = useNavigate()
  const dialog = useDialog()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || dialog.active()) return
      const parentID = server.data.session.get(sessionID)?.parentID
      if (!parentID) return
      const path = event.composedPath()
      if (path.some((item) => item instanceof HTMLElement && (editable(item) || item.closest("[data-prevent-autofocus]"))))
        return
      const active = document.activeElement
      if (active instanceof HTMLElement && (editable(active) || active.closest("[data-prevent-autofocus]"))) return
      event.preventDefault()
      navigate(sessionHref(server.key, parentID))
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [server, sessionID, dialog, navigate])
}

function editable(element: HTMLElement) {
  return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(element.tagName) || element.isContentEditable
}

function SessionNotFound(props: { conn: ServerConnection; sessionID: string }) {
  const i18n = useI18n()
  const tabs = useTabs()
  const close = () => {
    const tab = findSessionTab(tabs.tabs(), serverKey(props.conn), props.sessionID)
    if (tab) tabs.closeTab(tabs.tabs().indexOf(tab))
  }
  return (
    <div data-component="session-not-found" className="flex min-h-0 flex-1 items-center justify-center px-6">
      <EmptyState className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex flex-col items-center gap-2">
          <span className="text-base font-medium text-foreground">{i18n.t("session.error.notFound")}</span>
          <span className="text-sm text-muted-foreground">{i18n.t("session.error.notFound.description")}</span>
        </span>
        <span className="flex max-w-full flex-col items-center gap-1">
          <span className="max-w-full break-all text-xs text-muted-foreground">{serverName(props.conn)}</span>
          <code className="max-w-full break-all font-mono text-xs">{props.sessionID}</code>
        </span>
        <Button variant="outline" leadingIcon={X} onClick={close}>
          {i18n.t("session.error.notFound.closeTab")}
        </Button>
      </EmptyState>
    </div>
  )
}
