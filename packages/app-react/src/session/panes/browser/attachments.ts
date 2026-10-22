// The desktop browser's attachments (#584): one native browser registration per session, owned by
// the window rather than by the mounted session route, so the agent's browser survives visiting
// Settings or another tab — the Solid BrowserAttachments as plain TS. Pages close when the session
// tab or the setting goes; a server whose plugin lacks the browser RPC is never asked again.

import { createBrowserConnection } from "@opencode/app/react-reuse/browser-connection"
import type {
  BrowserPaneCommand,
  BrowserPanePlatform,
  BrowserPaneRegistration,
  BrowserPaneState,
  BrowserPaneTarget,
} from "@opencode/app/react-reuse/browser-pane"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { createStore } from "../../../core/store"

export type BrowserTabState = NonNullable<BrowserPaneState>["tabs"][number]
export type BrowserTabID = BrowserTabState["id"]

export type BrowserAttachment = {
  registration?: BrowserPaneRegistration
  browser: BrowserPaneState
  suspended: boolean
  /** A translated message, ready to show. */
  error?: string
}

/** What an attachment needs of a server: its key, where it is reached and its events. */
export type BrowserServer = {
  key: string
  endpoint: () => BrowserPaneTarget["endpoint"]
  listen: (handler: (event: OpenCodeEvent) => void) => () => void
}

type Live = {
  server: BrowserServer
  sessionID: string
  wake: () => void
  command: (command: BrowserPaneCommand) => Promise<void>
  dispose: () => void
}

export const attachmentKey = (serverKey: string, sessionID: string) => `${serverKey}\n${sessionID}`

export function createBrowserAttachments(input: {
  pane?: BrowserPanePlatform
  /** The experimental browser setting. */
  enabled: () => boolean
  messages: { replaced: string; failed: string }
}) {
  const store = createStore<Record<string, BrowserAttachment | undefined>>({})
  const unsupported = createStore<Record<string, true | undefined>>({})
  const live = new Map<string, Live>()
  const focus = new Map<string, Set<(tabID: BrowserTabID) => void>>()

  const set = (id: string, value: BrowserAttachment | undefined) => store.set((all) => ({ ...all, [id]: value }))
  const close = (id: string) => {
    live.get(id)?.dispose()
    live.delete(id)
    if (store.get()[id]) set(id, undefined)
  }

  return {
    store,
    unsupported,
    enabled: () => !!input.pane && input.enabled(),
    supported: (serverKey: string) => !unsupported.get()[serverKey],
    state: (serverKey: string, sessionID: string) => store.get()[attachmentKey(serverKey, sessionID)],
    attach(server: BrowserServer, sessionID: string) {
      const id = attachmentKey(server.key, sessionID)
      const pane = input.pane
      if (live.has(id) || !pane || !input.enabled() || unsupported.get()[server.key]) return
      const connection = createBrowserConnection({
        pane,
        // The current endpoint at every wake, including after a sidecar replacement.
        target: () => ({ serverKey: server.key, sessionID, endpoint: server.endpoint() }),
        focus: (tabID) => focus.get(id)?.forEach((listener) => listener(tabID)),
        change: (state) => {
          if (state.error === "browser.pane.unsupported") {
            unsupported.set((all) => ({ ...all, [server.key]: true }))
            return close(id)
          }
          set(id, {
            ...state,
            error:
              state.error === "browser.pane.replaced"
                ? input.messages.replaced
                : state.error
                  ? input.messages.failed
                  : undefined,
          })
        },
      })
      // A new session shows before the server finishes creating it; its creation or a run wakes it.
      const stop = server.listen((event) => {
        if (event.type !== "session.created" && event.type !== "session.execution.started") return
        if (event.data.sessionID === sessionID) connection.wake()
      })
      live.set(id, {
        server,
        sessionID,
        wake: connection.wake,
        command: connection.command,
        dispose: () => {
          stop()
          connection.dispose()
        },
      })
      if (!store.get()[id]) set(id, { browser: null, suspended: false })
      connection.wake()
    },
    /** Close every attachment the predicate no longer keeps (its session tab closed, the setting off). */
    retain(keep: (serverKey: string, sessionID: string) => boolean) {
      const on = !!input.pane && input.enabled()
      Array.from(live.entries()).forEach(([id, entry]) => {
        if (on && keep(entry.server.key, entry.sessionID)) return
        close(id)
      })
    },
    wake(serverKey: string, sessionID: string) {
      live.get(attachmentKey(serverKey, sessionID))?.wake()
    },
    /** Desktop focus requests for a mounted session; nothing is replayed to sessions mounted later. */
    onFocus(serverKey: string, sessionID: string, listener: (tabID: BrowserTabID) => void) {
      const id = attachmentKey(serverKey, sessionID)
      const listeners = focus.get(id) ?? new Set()
      listeners.add(listener)
      focus.set(id, listeners)
      return () => {
        listeners.delete(listener)
        if (!listeners.size) focus.delete(id)
      }
    },
    command(serverKey: string, sessionID: string, command: BrowserPaneCommand) {
      const entry = live.get(attachmentKey(serverKey, sessionID))
      if (!entry) return Promise.reject(new Error("browser.pane.unavailable"))
      return entry.command(command)
    },
    dispose: () => Array.from(live.keys()).forEach(close),
  }
}

export type BrowserAttachments = ReturnType<typeof createBrowserAttachments>
