// The routed session's composer (#584), ported from the Solid session composer region: the
// session's draft and model pick, sends to the session (steer or queue behind a running turn),
// the queued prompts above it, and typing anywhere on the screen landing in it. While a request
// dock asks something the composer steps aside; a subagent's session points back to its parent.

import { Button } from "@buff/ui/react"
import { useEffect, useMemo, useRef } from "react"
import { useCommandRegistration } from "../../commands/provider"
import { useCore, useServerData } from "../../react/core"
import { useI18n } from "../../i18n/provider"
import { useNavigate } from "../../router/router"
import { sessionHref } from "../../router/routes"
import { useDialog } from "../../dialog/dialogs"
import { setCursorPosition } from "@opencode/app/react-reuse/composer-dom"
import { promptLength } from "@opencode/app/react-reuse/composer-prompt-parts"
import { useSession, useSessionView } from "../context"
import { useRequestsBlocked } from "../docks/requests"
import { PermissionModeControl } from "../docks/permission-mode"
import { Composer } from "./composer"
import type { ContextItem } from "@opencode/app/react-reuse/composer-schema"
import { usePaneSession } from "../panes/session"
import { tabsOf } from "../panes/layout"
import { showToast } from "../../shell/notifications/toast"
import { promptContextActions, usePromptContextMirror } from "./prompt-context"
import { createSessionRevert } from "./revert"
import { BuffBalanceChip, BuffFundsStrip } from "../../buff/billing/billing"
import { BuffContextChip } from "../../buff/context/chip"
import { BuffGitChip } from "../../buff/git/chip"
import { BuffGoalBar } from "../../buff/goal/goal-bar"
import { BuffNoModelStrip } from "../../buff/no-model/strip"
import { BuffSnapshotGitStrip } from "../../buff/snapshot-git/strip"
import { BuffTrustStrip } from "../../buff/trust/strip"
import { RevertedStrip } from "./buff/reverted"
import { TodoBar } from "./buff/todo"
import { draftRegistry } from "./draft/registry"
import { BackgroundChip } from "../timeline/background-work"
import { useRevertConfirm } from "../timeline/buff-turn"
import { useModelSelection } from "./models/use-selection"
import { useSessionQueue } from "./queue/use-queue"
import { QueuePanel } from "./queue/queue-panel"
import { useSettings } from "../../shell/settings-context"
import { PreparingComposer } from "../preparing/composer"
import { usePendingSession } from "../preparing/pending"
import type { ComposerAdapter, ComposerSession } from "./submit/submit"

export function SessionComposer() {
  const session = useSession()
  const directory = useServerData(session.server, (state) => state.session.info[session.sessionID]?.location.directory)
  const parentID = useServerData(session.server, (state) => state.session.info[session.sessionID]?.parentID)
  const blocked = useRequestsBlocked()
  const pending = usePendingSession()
  // A session being prepared (a new worktree first) takes the next message without sending it.
  if (pending)
    return (
      <div data-component="session-composer-dock" className="composer-region">
        <div className="composer-region__inner">
          <PreparingComposer tabKey={pending} />
        </div>
      </div>
    )
  if (directory === undefined) return null
  if (parentID) return <ChildNote parentID={parentID} />
  return (
    <div data-component="session-composer-dock" className="composer-region">
      <div className="composer-region__inner" hidden={blocked}>
        {!blocked && <ActiveComposer directory={directory} />}
      </div>
    </div>
  )
}

function ActiveComposer(props: { directory: string }) {
  const core = useCore()
  const dialog = useDialog()
  const { server, sessionID } = useSession()
  const host = useMemo(() => ({ storage: core.platform.storage, draftStore: core.platform.draftStore }), [core.platform])
  const draft = draftRegistry(host).get({
    type: "session",
    scope: core.scope(server.key),
    directory: props.directory,
    sessionID,
  })
  const selection = useModelSelection({ server, directory: props.directory, sessionID })
  const working = useServerData(server, (state) => state.session.active[sessionID] === "running")
  const behavior = useSettings((settings) => settings.general.followUpBehavior)
  const editor = useRef<HTMLElement | undefined>(undefined)
  const queue = useSessionQueue({ server, sessionID, directory: props.directory, draft, working, behavior, editor })
  const panes = usePaneSession()
  const view = useSessionView()
  const i18n = useI18n()
  usePromptContextMirror(draft, panes.sessionKey)
  const context = useMemo(() => {
    const key = panes.sessionKey
    if (!key) return undefined
    const actions = promptContextActions(key)
    return {
      remove: actions.remove,
      clear: actions.clear,
      // A comment chip opens where it was written: the review, or the file's tab.
      open: (item: ContextItem) => {
        actions.focus(item)
        view.openReview()
        if (item.commentOrigin === "review") return panes.window.layout.review(key).openPath(item.path)
        const tab = panes.files?.tab(item.path)
        if (!tab) return
        panes.window.layout.tabs(key).open(tab)
        panes.window.layout.tabs(key).setActive(tab)
      },
    }
  }, [panes.sessionKey, panes.window, panes.files, view])
  const recentFiles = () => {
    const key = panes.sessionKey
    const files = panes.files
    if (!key || !files) return []
    const stored = tabsOf(panes.window.layout.layout.get(), key)
    const order = stored.active ? [stored.active, ...stored.all.filter((tab) => tab !== stored.active)] : stored.all
    return [...new Set(order.flatMap((tab) => files.pathFromTab(tab) ?? []))]
  }
  // Buff (#449): every rewind asks first, showing what comes back.
  const confirm = useRevertConfirm(server, sessionID, () => props.directory)
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  const revert = useMemo(
    () =>
      createSessionRevert({
        server,
        sessionID,
        directory: props.directory,
        draft,
        notify: (error) =>
          showToast({ title: i18n.t("common.requestFailed"), description: error instanceof Error ? error.message : String(error) }),
        confirm: (message) => confirmRef.current(message),
      }),
    [server, sessionID, props.directory, draft, i18n],
  )
  const scope = useMemo(() => ({ server, directory: props.directory, sessionID }), [server, props.directory, sessionID])
  const prompts = useServerData(server, (state) =>
    (state.session.message[sessionID] ?? []).some((message) => message.type === "user"),
  )
  const reverted = useServerData(server, (state) => !!state.session.info[sessionID]?.revert)
  // Rewind the last prompt (through the #449 preview) and bring it back, as the Solid session commands.
  useCommandRegistration(`session.revert:${server.key}/${sessionID}`, () => [
    {
      id: "session.undo",
      title: i18n.t("command.session.undo"),
      description: i18n.t("command.session.undo.description"),
      category: i18n.t("command.category.session"),
      slash: "undo",
      disabled: !prompts,
      onSelect: () => void revert.undo(),
    },
    {
      id: "session.redo",
      title: i18n.t("command.session.redo"),
      description: i18n.t("command.session.redo.description"),
      category: i18n.t("command.category.session"),
      slash: "redo",
      disabled: !reverted,
      onSelect: () => void revert.redo(),
    },
  ])

  const target: ComposerSession = {
    id: sessionID,
    directory: props.directory,
    api: server.api().session,
    prompt: (input) => server.data.session.prompt(input),
    setStatus: (status) => server.data.session.setStatus(sessionID, status),
    current: () => server.data.state.get().session.info[sessionID],
    admitted: (messageID) =>
      server.data.session.input.has(sessionID, messageID) || !!server.data.session.message.get(sessionID, messageID),
  }
  const adapter: ComposerAdapter = {
    kind: "active-session",
    draft,
    working: () => working,
    submitted: () => undefined,
    selection: selection.current,
    track: selection.track,
    session: () => target,
    interrupt: () =>
      server
        .api()
        .session.interrupt({ sessionID, resume: true })
        .then(() => undefined)
        .catch(() => undefined),
  }

  // A printable key anywhere on the screen types into the composer, at the caret it remembers.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || dialog.active()) return
      if (event.key.length !== 1 || event.key === "Unidentified" || event.ctrlKey || event.metaKey || event.altKey) return
      const path = event.composedPath()
      if (path.some((item) => item instanceof HTMLElement && (editable(item) || item.closest("[data-prevent-autofocus]"))))
        return
      const active = document.activeElement
      if (active instanceof HTMLElement && (editable(active) || active.closest("[data-prevent-autofocus]"))) return
      const element = editor.current
      if (!element) return
      element.focus()
      setCursorPosition(element, draft.cursor() ?? promptLength(draft.current()))
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [dialog, draft])

  return (
    <>
      <QueuePanel queue={queue} />
      <div className="relative z-10">
        <div className="buff-bars">
          <BuffGoalBar {...scope} />
          <TodoBar scope={scope} />
          <BuffTrustStrip {...scope} />
          <BuffNoModelStrip {...scope} />
          <BuffFundsStrip {...scope} />
          <BuffSnapshotGitStrip {...scope} />
          <RevertedStrip scope={scope} onRedo={() => void revert.redo()} />
        </div>
        <Composer
          recentFiles={recentFiles}
          context={context}
          server={server}
          directory={props.directory}
          draft={draft}
          selection={selection}
          adapter={adapter}
          working={working}
          queue={queue}
          borderUnderlay
          beforeModel={<PermissionModeControl selection={selection} server={server} sessionID={sessionID} />}
          onEditor={(element) => {
            editor.current = element
          }}
        />
        <div className="composer-chips">
          <BuffContextChip {...scope} />
          <BuffGitChip {...scope} />
          <BackgroundChip />
          <span className="ms-auto">
            <BuffBalanceChip {...scope} />
          </span>
        </div>
      </div>
    </>
  )
}

function editable(element: HTMLElement) {
  return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(element.tagName) || element.isContentEditable
}

function ChildNote(props: { parentID: string }) {
  const i18n = useI18n()
  const navigate = useNavigate()
  const dialog = useDialog()
  const { serverKey } = useSession()
  // Escape anywhere on a subagent's screen returns to its parent, as the Solid composer region
  // does, unless a field, a button or a dialog has the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || dialog.active()) return
      const path = event.composedPath()
      const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
      if (target && editable(target)) return
      if (path.some((item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]"))) return
      const active = document.activeElement
      if (active instanceof HTMLElement && (editable(active) || active.closest("[data-prevent-autofocus]"))) return
      event.preventDefault()
      navigate(sessionHref(serverKey, props.parentID))
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [dialog, navigate, serverKey, props.parentID])
  return (
    <div data-component="session-composer-dock" className="composer-region">
      <div className="composer-child-note">
        <span>{i18n.t("session.child.promptDisabled")} </span>
        <Button variant="link" size="inline" onClick={() => navigate(sessionHref(serverKey, props.parentID))}>
          {i18n.t("session.child.backToParent")}
        </Button>
      </div>
    </div>
  )
}
