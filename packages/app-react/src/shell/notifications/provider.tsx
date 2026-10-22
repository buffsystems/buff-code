// Notifications in the window (#584): each server's finished turns and errors become unseen marks
// on their tabs and projects and, when enabled, a system notification; showing a session marks
// it seen. Ported from the Solid window's notification context.

import type { SessionInfo } from "@opencode/client/promise"
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react"
import { serverKey, type Server, type ServerConnection } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useCore, useServers } from "../../react/core"
import { createStore } from "../../core/store"
import { useStore } from "../../react/use-store"
import { useLocation, useRoute } from "../../router/router"
import { sessionHref } from "../../router/routes"
import { playSoundById } from "@opencode/app/react-reuse/sound"
import { useSettingsModel } from "../settings-context"
import { useTabs } from "../tabs/provider"
import { findSessionTab, tabServer } from "../tabs/tabs"
import { createNotificationCoordinator, type NotificationCoordinator } from "./coordinator"
import { createNotifications, type Notifications } from "./notifications"

type Registry = { get: (key: string) => Notifications }
const NotificationsContext = createContext<Registry | undefined>(undefined)

export function NotificationsProvider(props: { children?: ReactNode }) {
  const core = useCore()
  const [registry] = useState<Registry>(() => {
    const all = new Map<string, Notifications>()
    const storage = core.platform.storage("opencode.global.dat")
    return {
      get(key) {
        const existing = all.get(key)
        if (existing) return existing
        const created = createNotifications({ storage, scope: core.scope(key) })
        all.set(key, created)
        return created
      },
    }
  })
  const servers = useServers()
  const [coordinator, setCoordinator] = useState<NotificationCoordinator>()
  useEffect(() => {
    const created = createNotificationCoordinator()
    setCoordinator(created)
    return created.dispose
  }, [])
  return (
    <NotificationsContext value={registry}>
      {coordinator &&
        servers.map((conn) => (
          <ServerNotifier
            key={serverKey(conn)}
            conn={conn}
            notifications={registry.get(serverKey(conn))}
            coordinator={coordinator}
          />
        ))}
      <ViewedMarker registry={registry} />
      {props.children}
    </NotificationsContext>
  )
}

function useRegistry() {
  const registry = use(NotificationsContext)
  if (!registry) throw new Error("useNotifications must be used inside NotificationsProvider")
  return registry
}

/** What a session has unseen on a server. */
export function useSessionUnseen(key: string, sessionID: string) {
  const notifications = useRegistry().get(key)
  return useStore(
    notifications.store,
    () => ({
      count: notifications.session.unseenCount(sessionID),
      error: notifications.session.unseenHasError(sessionID),
    }),
    (a, b) => a.count === b.count && a.error === b.error,
  )
}

/** A session shown off its own route — a side conversation's tab (#470) — has its notifications seen. */
export function useSessionViewed(key: string, sessionID: string) {
  const notifications = useRegistry().get(key)
  const unseen = useStore(notifications.store, () => notifications.session.unseenCount(sessionID))
  useEffect(() => {
    if (unseen > 0) notifications.session.markViewed(sessionID)
  }, [notifications, sessionID, unseen])
}

/** What a project (its folder and its worktrees) has unseen on a server, and how to clear it. */
export function useProjectUnseen(key: string, directories: readonly string[]) {
  const notifications = useRegistry().get(key)
  const count = useStore(notifications.store, () =>
    directories.reduce((total, directory) => total + notifications.project.unseenCount(directory), 0),
  )
  return {
    count,
    markViewed: () =>
      directories
        .filter((directory) => notifications.project.unseenCount(directory) > 0)
        .forEach((directory) => notifications.project.markViewed(directory)),
  }
}

const appended = new Set<string>()

function ServerNotifier(props: {
  conn: ServerConnection
  notifications: Notifications
  coordinator: NotificationCoordinator
}) {
  const core = useCore()
  const platform = usePlatform()
  const i18n = useI18n()
  const tabs = useTabs()
  const settings = useSettingsModel()
  const server = core.registry.ensure(props.conn)
  // Where the window is when an event lands: a desktop window's route lives in memory, not the address.
  const location = useLocation()
  const shown = useRef(location.pathname)
  shown.current = location.pathname
  useEffect(
    () =>
      server.event.listen((event) => {
        if (event.type !== "session.execution.succeeded" && event.type !== "session.execution.failed") return
        const key = `${server.key}\0${event.id}`
        if (appended.has(key)) return
        appended.add(key)
        const failed = event.type === "session.execution.failed"
        const sessionID = event.data.sessionID
        void lookup(server, sessionID).then((session) => {
          if (session?.parentID || (!failed && !session)) return
          const current = settings.store.get()
          const sound = failed
            ? current.sounds.errorsEnabled && current.sounds.errors
            : current.sounds.agentEnabled && current.sounds.agent
          // Buff: only for a session the window has a tab of, as in the Solid window.
          if (sound && findSessionTab(tabs.tabs(), server.key, sessionID))
            void props.coordinator.sound(key, () => playSoundById(sound))
          const viewed = shown.current === sessionHref(server.key, sessionID)
          props.notifications.append({
            type: failed ? "error" : "turn-complete",
            session: sessionID,
            directory: session?.location.directory,
            time: Date.now(),
            viewed,
            ...(failed ? { error: event.data.error } : {}),
          })
          const enabled = failed ? current.notifications.errors : current.notifications.agent
          if (!enabled) return
          const open = () => tabs.select(tabs.addSessionTab({ server: tabServer(server.key), sessionId: sessionID }))
          void props.coordinator.system(key, () =>
            platform.notify(
              i18n.t(failed ? "notification.session.error.title" : "notification.session.responseReady.title"),
              session?.title ?? (failed ? i18n.t("notification.session.error.fallbackDescription") : sessionID),
              open,
            ),
          )
        })
      }),
    [server, props.notifications, props.coordinator],
  )
  return null
}

function lookup(server: Server, sessionID: string): Promise<SessionInfo | undefined> {
  const known = server.data.session.get(sessionID)
  if (known) return Promise.resolve(known)
  return server.data.session
    .sync(sessionID)
    .then(() => server.data.session.get(sessionID))
    .catch(() => undefined)
}

/** The shown session's notifications are seen. */
function ViewedMarker(props: { registry: Registry }) {
  const route = useRoute()
  const key = route.name === "session" ? route.serverKey : undefined
  const sessionID = route.name === "session" ? route.sessionID : undefined
  const notifications = key ? props.registry.get(key) : undefined
  const unseen = useStore(notifications?.store ?? idle, () =>
    notifications && sessionID ? notifications.session.unseenCount(sessionID) : 0,
  )
  useEffect(() => {
    if (notifications && sessionID && unseen > 0) notifications.session.markViewed(sessionID)
  }, [notifications, sessionID, unseen])
  return null
}

const idle = createStore(undefined)
