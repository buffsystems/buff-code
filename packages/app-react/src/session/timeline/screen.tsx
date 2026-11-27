// The session timeline in the session screen's `timeline` slot (#584): the transcript, headed on
// wide screens by the title row with the Find bar, sticky inside the scroller as in the Solid
// window (a phone shows the title in its tab sheet).

import { replaceable } from "../simple/chat"
import { turnFailure } from "@opencode/schema/buff-turn-failure"
import { offerUnsent } from "../composer/unsent"
import { PhoneSessionBanner } from "@buff/ui/react"
import { BuffMobile } from "@opencode/schema/buff-mobile"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { SessionTurnFailure } from "@opencode/session-ui/actions"
import { createPortal } from "react-dom"
import type { Server } from "../../core/servers"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { retryInput } from "@opencode/app/react-reuse/retry-turn"
import { readLocalImage } from "@opencode/app/react-reuse/server-image"
import { useCore } from "../../react/core"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { ShareDialog } from "../share/share-dialog"
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
import { SimpleTranscript } from "../simple/transcript"
import { ChatPlugins } from "../../buff/chat-plugins/host"
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
  // Buff (#972): the simple layout shows the chat as the web client does; the developer one —
  // the window's own timeline.
  const layout = useSettings((settings) => settings.appearance.layout)
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
  const header = desktop ? (
    <TimelineTitleRow active={props.active} />
  ) : props.preparing ? (
    <div data-session-title className="timeline-header">
      <div className="timeline-header__bar">
        <h1 className="timeline-header__title">{i18n.t("session.tab.session")}</h1>
      </div>
    </div>
  ) : undefined
  const readFile = useCallback(
    async (path: string) => {
      const blob = await readLocalImage(server.api(), directory, path, new AbortController().signal)
      if (!blob) throw new Error("not a picture")
      return blob
    },
    [server, directory],
  )
  const openFile = useCallback((path: string) => void sideActions()?.openFile(path), [])
  // Buff (#595): the chat's plugins, for both layouts.
  const withPlugins = (transcript: ReactNode) => (
    <ChatPlugins server={server} sessionID={props.sessionID} directory={directory} readOnly={child}>
      {transcript}
    </ChatPlugins>
  )
  if (layout === "simple" && !props.preparing)
    return withPlugins(
      <SimpleTranscript
        server={server}
        sessionID={props.sessionID}
        header={header}
        // A helper's chat is only read: nothing in it is asked again or rewound.
        {...(child || !directory
          ? {}
          : {
              retry: turns.again,
              retryHelps: turns.retryHelps,
              rewind: (messageID: string) => void turns.revert?.({ sessionID: props.sessionID, messageID }),
              failureCard: turns.failureCard,
              ...(turns.turnSummary ? { summary: turns.turnSummary } : {}),
            })}
        openFile={openFile}
        readFile={readFile}
        active={props.active}
      />,
    )
  return withPlugins(
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
      header={header}
    />,
  )
}

// Buff's turn actions (#449, #458): rewind to a prompt after a preview, the changed files under a
// finished turn, and a failed turn's card with retry.
function useTurnActions(
  server: Server,
  sessionID: string,
  directory: string,
): TimelineActions & {
  retry: (userMessageID: string) => void
  /** The request asked again in place of what followed it: the answer is replaced, files stay. */
  again: (userMessageID: string) => void
  retryHelps: (failure: SessionTurnFailure) => boolean
  failureCard: (failure: SessionTurnFailure) => ReactNode
} {
  const core = useCore()
  const i18n = useI18n()
  const dialog = useDialog()
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
      setAside: (bringBack) => offerUnsent(i18n.buff.t, bringBack),
    })
    const failed = (error: unknown) =>
      void showToast({
        variant: "error",
        title: i18n.buff.t("Could not retry"),
        description: formatServerError(error, undefined, i18n.t("common.requestFailed")),
      })
    const retry = (userMessageID: string) => {
      const message = server.data.session.message.get(sessionID, userMessageID)
      if (message?.type !== "user") return
      return server.data.session.prompt(retryInput(sessionID, message)).then(() => undefined, failed)
    }
    // #757: the same message on the model just chosen — switched first, so the turn runs on it.
    const retryWith = async (userMessageID: string, model: { providerID: string; modelID: string }) => {
      const message = server.data.session.message.get(sessionID, userMessageID)
      if (message?.type !== "user") return
      const input = retryInput(sessionID, message)
      return server
        .api()
        .session.switchModel({ sessionID, model: { id: model.modelID, providerID: model.providerID } })
        .then(() => server.data.session.prompt({ ...input, metadata: { ...input.metadata, model } }))
        .then(() => undefined, failed)
    }
    const followUp = (input: {
      readonly text: string
      readonly metadata: { readonly omitMedia: string[]; readonly omitAs: string }
    }) =>
      server.data.session
        .prompt({ sessionID, text: input.text, metadata: { ...input.metadata } })
        .then(() => undefined, failed)
    // `own` — the card retries by itself (the developer timeline). In the simple layout the turn
    // has «Повторить», and another model asks again in place of the failed answer too.
    const failureCard = (failure: SessionTurnFailure, own: boolean) => (
      <TurnFailure
        server={server}
        directory={directory}
        sessionID={sessionID}
        failure={failure}
        {...(own ? { onRetry: () => retry(failure.userMessageID) } : {})}
        onRetryWith={(model) =>
          // In place of the failed answer only where nothing came after it and no rewind is
          // staged; an older failed turn is asked again at the chat's end, the later turns kept.
          !own && replaces(failure.userMessageID)
            ? againRef.run(failure.userMessageID, model)
            : retryWith(failure.userMessageID, model)
        }
        onFollowUp={followUp}
      />
    )
    // #972: the simple layout's «Повторить» says the answer is replaced — so the chat is taken
    // back to the request first (files left as they are), and the request is sent again.
    const replaces = (userMessageID: string) => {
      const state = server.data.state.get().session
      return replaceable(state.message[sessionID] ?? [], !!state.info[sessionID]?.revert, userMessageID)
    }
    const againRef: {
      run: (id: string, model?: { providerID: string; modelID: string }) => Promise<void> | undefined
    } = {
      run: () => undefined,
    }
    const again = async (userMessageID: string, model?: { providerID: string; modelID: string }) => {
      const message = server.data.session.message.get(sessionID, userMessageID)
      if (message?.type !== "user") return
      const api = server.api().session
      if (server.data.session.status(sessionID) === "running") await api.interrupt({ sessionID }).catch(() => undefined)
      const staged = await api.revert.stage({ sessionID, messageID: userMessageID, files: false }).then(
        () => true,
        (error: unknown) => (failed(error), false),
      )
      if (!staged) return
      const input = retryInput(sessionID, message)
      const send = model
        ? api
            .switchModel({ sessionID, model: { id: model.modelID, providerID: model.providerID } })
            .then(() => server.data.session.prompt({ ...input, metadata: { ...input.metadata, model } }))
        : server.data.session.prompt(input)
      return send.then(
        () => undefined,
        // Not sent: the rewind is undone, so the request stays in the chat and nothing hangs staged.
        (error: unknown) =>
          api.revert
            .clear({ sessionID })
            .catch(() => undefined)
            .then(() => failed(error)),
      )
    }
    againRef.run = again
    return {
      retry: (userMessageID: string) => void retry(userMessageID),
      again: (userMessageID: string) => void again(userMessageID),
      // With the limit used up a retry only fails again — the way out is the top-up on the card.
      retryHelps: (failure: SessionTurnFailure) =>
        turnFailure(failure, failure.providerID, i18n.buff.t, failure.providerID).action !== "top-up",
      revert: ({ messageID }) => revert.to(messageID),
      // Buff (#817): a public link to one message — the share dialog opens with it picked.
      share: (messageID) =>
        dialog.show((close) => (
          <ShareDialog server={server} sessionID={sessionID} preselect={[messageID]} onClose={close} />
        )),
      turnSummary: ({ userMessageID }) => (
        <TurnSummary
          server={server}
          sessionID={sessionID}
          userMessageID={userMessageID}
          onOpenFile={(path) => sideActions()?.openFile(path)}
          onRevert={() => void revert.to(userMessageID)}
        />
      ),
      turnFailure: (failure) => failureCard(failure, true),
      // The simple layout's turn has «Повторить» of its own under the card.
      failureCard: (failure: SessionTurnFailure) => failureCard(failure, false),
    }
  }, [core, server, sessionID, directory, i18n, dialog])
}

/** A kept view keeps its title row; only the shown one registers the summary's command. */
function TimelineTitleRow(props: { active: boolean }) {
  const session = useSession()
  const search = useStore(publishedSearches, (all) => all[`${session.server.key}/${session.sessionID}`])
  const navigateToSession = useNavigateToSession(session.server, session.sessionID)
  const view = useSessionView()
  const child = useServerData(session.server, (state) => !!state.session.info[session.sessionID]?.parentID)
  const i18n = useI18n()
  // Buff (#640): a session started on a phone says so under its title.
  const phone = useServerData(session.server, (state) => {
    const origin = BuffMobile.phoneOrigin(state.session.info[session.sessionID]?.metadata)
    return origin ? (origin.device ?? "") : null
  })
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
      below={phone !== null && <PhoneSessionBanner device={phone} locale={i18n.locale === "ru" ? "ru" : "en"} />}
    />
  )
}
