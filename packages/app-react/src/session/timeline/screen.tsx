// The session timeline in the session screen's `timeline` slot (#584): the transcript, headed on
// wide screens by the title row with the Find bar, sticky inside the scroller as in the Solid
// window (a phone shows the title in its tab sheet).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { Server } from "../../core/servers"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { retryInput } from "@opencode/app/react-reuse/retry-turn"
import { readLocalImage } from "@opencode/app/react-reuse/server-image"
import { useCore } from "../../react/core"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { draftRegistry } from "../composer/draft/registry"
import { createSessionRevert } from "../composer/revert"
import { sideActions } from "../panes/side-actions"
import { TurnFailure, TurnSummary, useRevertConfirm } from "./buff-turn"
import type { TimelineActions } from "./context"
import { useServerData } from "../../react/core"
import { useStore } from "../../react/use-store"
import { sessionHref } from "../../router/routes"
import { useNavigateToSession } from "../navigate"
import { SessionProvider, useSession, useSessionView, type SessionContextValue } from "../context"
import { SessionHeaderActions } from "../header-actions"
import { SessionProjectMenu } from "../project-menu"
import { SummaryPopover } from "../../summary/popover"
import { TimelineHeader } from "./header"
import { publishedSearches } from "./search"
import { TimelineSearchBar } from "./search-bar"
import { useSettings } from "../../shell/settings-context"
import { SessionTimeline, useMediaQuery } from "./timeline"
import { usePendingSession } from "../preparing/pending"

const cachedViews = 16

type View = {
  key: string
  server: Server
  sessionID: string
  directory?: string
  container: HTMLDivElement
  /** The session context the view was shown with; its title row reads it while it is kept. */
  session: SessionContextValue
}

/**
 * The routed session's timeline, with the last sessions' views kept alive but detached, as the
 * Solid view cache keeps them: each view renders into its own element, and only the shown one is
 * attached, so switching back to a tab re-attaches its rows as they were. Views of another
 * directory are dropped, since their providers follow the selected location.
 */
export function TimelineScreen() {
  const session = useSession()
  const i18n = useI18n()
  const pending = usePendingSession()
  const server = session.server
  const key = `${server.key}/${session.sessionID}`
  const directory = useServerData(server, (state) => state.session.info[session.sessionID]?.location.directory)
  const host = useRef<HTMLDivElement>(null)
  const [views, setViews] = useState<View[]>([])
  const current = views[0]
  if (current?.key !== key || (directory && current.directory !== directory)) {
    const kept = views.filter(
      (view) => view.key !== key && (!directory || !view.directory || view.directory === directory),
    )
    const existing = views.find((view) => view.key === key)
    setViews(
      [
        {
          key,
          server,
          sessionID: session.sessionID,
          directory,
          container: existing?.container ?? viewContainer(),
          session,
        },
        ...kept,
      ].slice(0, cachedViews),
    )
  }
  useLayoutEffect(() => {
    const element = host.current
    if (element && current && element.firstChild !== current.container) element.replaceChildren(current.container)
  }, [current])
  return (
    <div ref={host} className="absolute inset-0">
      {views.map((view) =>
        createPortal(
          <SessionProvider value={view.key === key ? session : view.session}>
            <TimelineView
              server={view.server}
              sessionID={view.sessionID}
              active={view.key === key}
              preparing={view.key === key && pending ? i18n.t("session.new.worktree.creating") : undefined}
            />
          </SessionProvider>,
          view.container,
          view.key,
        ),
      )}
    </div>
  )
}

function viewContainer() {
  const element = document.createElement("div")
  element.className = "absolute inset-0"
  return element
}

function TimelineView(props: { server: Server; sessionID: string; active: boolean; preparing?: string }) {
  const navigateToSession = useNavigateToSession(props.server, props.sessionID)
  const i18n = useI18n()
  const desktop = useMediaQuery("(min-width: 768px)")
  const detail = useSettings((settings) => settings.general.timelineDetail)
  const server = props.server
  const location = useServerData(server, (state) => state.session.info[props.sessionID]?.location)
  // Model names in notices and answers come from the session location's catalog.
  useEffect(() => {
    if (location) void server.data.location.model.sync(location).catch(() => undefined)
  }, [server, location?.directory])
  // Background shells run until the location's shell list drops them (the Solid session request
  // model's shell sync); a reconnect reads the list again, since the drop invalidated it.
  const connected = useStore(server.connection, (state) => state.status === "connected")
  useEffect(() => {
    if (location && connected) void server.data.shell.sync({ directory: location.directory }).catch(() => undefined)
  }, [server, location?.directory, connected])
  const child = useServerData(server, (state) => !!state.session.info[props.sessionID]?.parentID)
  const directory = location?.directory ?? ""
  const turns = useTurnActions(server, props.sessionID, directory)
  const readImage = useCallback(
    (path: string, signal: AbortSignal) => readLocalImage(server.api(), directory, path, signal),
    [server, directory],
  )
  const actions = useMemo<TimelineActions>(
    () => ({
      navigateToSession: (id: string) => void navigateToSession(id),
      sessionHref: (id: string) => sessionHref(server.key, id),
      ...(child || !directory ? {} : turns),
    }),
    [navigateToSession, server.key, child, directory, turns],
  )
  return (
    <SessionTimeline
      server={server}
      sessionID={props.sessionID}
      detail={detail}
      active={props.active}
      centered
      actions={actions}
      readImage={readImage}
      preparing={props.preparing}
      // A phone shows the title in its tab sheet; a session being prepared shows it here too.
      header={
        desktop ? (
          <TimelineTitleRow active={props.active} />
        ) : props.preparing ? (
          <div data-session-title className="timeline-header">
            <div className="timeline-header__bar">
              <h1 className="timeline-header__title">{i18n.t("session.tab.session")}</h1>
            </div>
          </div>
        ) : undefined
      }
    />
  )
}

// Buff's turn actions (#449, #458): rewind to a prompt after a preview, the changed files under a
// finished turn, and a failed turn's card with retry.
function useTurnActions(server: Server, sessionID: string, directory: string): TimelineActions {
  const core = useCore()
  const i18n = useI18n()
  const directoryRef = useRef(directory)
  directoryRef.current = directory
  const confirm = useRevertConfirm(server, sessionID, () => directoryRef.current)
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  return useMemo(() => {
    const host = { storage: core.platform.storage, draftStore: core.platform.draftStore }
    const revert = createSessionRevert({
      server,
      sessionID,
      directory,
      draft: draftRegistry(host).get({ type: "session", scope: core.scope(server.key), directory, sessionID }),
      notify: (error) =>
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      confirm: (message) => confirmRef.current(message),
    })
    const retry = (userMessageID: string) => {
      const message = server.data.session.message.get(sessionID, userMessageID)
      if (message?.type !== "user") return
      return server.data.session.prompt(retryInput(sessionID, message)).then(
        () => undefined,
        (error: unknown) =>
        void showToast({
          variant: "error",
          title: i18n.buff.t("Could not retry"),
          description: formatServerError(error, undefined, i18n.t("common.requestFailed")),
        }),
      )
    }
    return {
      revert: ({ messageID }) => revert.to(messageID),
      turnSummary: ({ userMessageID }) => (
        <TurnSummary
          server={server}
          sessionID={sessionID}
          userMessageID={userMessageID}
          onOpenFile={(path) => sideActions()?.openFile(path)}
          onRevert={() => void revert.to(userMessageID)}
        />
      ),
      turnFailure: (failure) => (
        <TurnFailure
          server={server}
          directory={directory}
          sessionID={sessionID}
          failure={failure}
          onRetry={() => retry(failure.userMessageID)}
        />
      ),
    }
  }, [core, server, sessionID, directory, i18n])
}

/** A kept view keeps its title row; only the shown one registers the summary's command. */
function TimelineTitleRow(props: { active: boolean }) {
  const session = useSession()
  const search = useStore(publishedSearches, (all) => all[`${session.server.key}/${session.sessionID}`])
  const navigateToSession = useNavigateToSession(session.server, session.sessionID)
  const view = useSessionView()
  const child = useServerData(session.server, (state) => !!state.session.info[session.sessionID]?.parentID)
  return (
    <TimelineHeader
      server={session.server}
      sessionID={session.sessionID}
      leading={<SessionProjectMenu />}
      actions={
        <>
          {search && <TimelineSearchBar search={search} />}
          <SessionHeaderActions>
            {!child && props.active && (
              <SummaryPopover
                server={session.server}
                sessionID={session.sessionID}
                sessionHref={(id) => sessionHref(session.server.key, id)}
                navigateToSession={(id) => void navigateToSession(id)}
                onReview={view.openReview}
              />
            )}
          </SessionHeaderActions>
        </>
      }
    />
  )
}
