// What every session slot reads (#584): the routed server and session, and the session tab's view
// state. See README.md.

import { createContext, startTransition, use, useEffect, useMemo, useState, type ReactNode } from "react"
import type { Server, ServerConnection } from "../core/servers"
import { useStore } from "../react/use-store"
import {
  createSessionViews,
  readSessionView,
  type PaneStore,
  type SessionView,
  type SessionViewActions,
  type SessionViews,
} from "./view"

export type SessionContextValue = {
  conn: ServerConnection
  server: Server
  serverKey: string
  sessionID: string
  /** The key of the tab showing the session (a subagent shows in its root's tab); its panes are kept by it. */
  viewKey?: string
}

const ViewsContext = createContext<SessionViews | undefined>(undefined)
const SessionContext = createContext<SessionContextValue | undefined>(undefined)

/** One per window, around the routes: every session tab's view state, over the tabs' panes. */
export function SessionViewsProvider(props: { panes: PaneStore; children?: ReactNode }) {
  const [views] = useState(() => createSessionViews(props.panes))
  return <ViewsContext value={views}>{props.children}</ViewsContext>
}

export function SessionProvider(props: { value: SessionContextValue; children?: ReactNode }) {
  return <SessionContext value={props.value}>{props.children}</SessionContext>
}

/** The routed session: `{ conn, server, serverKey, sessionID }`. */
export function useSession() {
  const session = use(SessionContext)
  if (!session) throw new Error("useSession must be used inside a session slot")
  return session
}

function useViews() {
  const views = use(ViewsContext)
  if (!views) throw new Error("useSessionView must be used inside SessionViewsProvider")
  return views
}

/** The session tab's view state and its actions, as the frame shows it: updated in the same render. */
export function useSessionViewNow(): SessionView & SessionViewActions {
  const views = useViews()
  const key = useSession().viewKey
  const panes = useStore(views.store, (all) => (key === undefined ? undefined : all[key]))
  const view = useMemo(() => readSessionView(panes), [panes])
  const actions = useMemo(() => views.actions(key), [views, key])
  return { ...view, ...actions }
}

/**
 * The session tab's view state and its actions, for the panes: a change reaches them as a
 * transition, after the frame has moved, so opening a region never waits for its contents to
 * render. Another tab's state arrives with the tab.
 */
export function useSessionView(): SessionView & SessionViewActions {
  const views = useViews()
  const key = useSession().viewKey
  const read = () => (key === undefined ? undefined : views.store.get()[key])
  const [state, setState] = useState(() => ({ key, panes: read() }))
  const current = state.key === key ? state : { key, panes: read() }
  if (current !== state) setState(current)
  useEffect(() => {
    const sync = () => {
      const panes = key === undefined ? undefined : views.store.get()[key]
      startTransition(() =>
        setState((previous) => (previous.key === key && previous.panes === panes ? previous : { key, panes })),
      )
    }
    sync()
    return views.store.subscribe(sync)
  }, [views, key])
  const view = useMemo(() => readSessionView(current.panes), [current.panes])
  const actions = useMemo(() => views.actions(key), [views, key])
  return { ...view, ...actions }
}
