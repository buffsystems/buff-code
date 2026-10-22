import type { SessionUserActions } from "@opencode/session-ui/message"
import { getFilename } from "@opencode/util/path"
import { useDialog } from "@opencode/ui/context/dialog"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "@opencode/ui/scroll-view"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, on, onMount, Show, type Accessor } from "solid-js"
import { Composer } from "@/composer/composer"
import { useComposerState } from "@/composer/persistence"
import { createComposerControls } from "@/composer/selection"
import { setCursorPosition } from "@/composer/editor/dom"
import { promptLength } from "@/composer/prompt-parts"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useLocal } from "@/providers/models/selection"
import { usePlatform } from "@/runtime/platform/platform"
import { useWorkspaceLocation } from "@/workspaces/location"
import { requireServerKey, sessionHref } from "@/shell/routes/session"
import { useComposerCommands } from "@/composer/commands"
import { useSessionCommands } from "../commands/use-session-commands"
import type { SessionModel } from "../model"
import type { SessionScreenLayout } from "../screen-layout"
import { syncPromptModel, syncSessionModel } from "../session-model-helpers"
import type { SessionTimelineInteraction } from "../timeline/interaction"
import { createSessionRevert } from "../revert"
import { SessionComposerRegion } from "./session-composer-region"
import { createSessionComposerController, type SessionComposerController } from "./controller"
import { SessionQueuePanel } from "./queue-panel"
import { resolveSessionComposerSelection } from "./selection"
import { createSessionRequestModel } from "../requests/model"
import { BuffBalanceChip, BuffFundsStrip } from "@/buff/billing"
import { BuffNoModelStrip } from "@/buff/no-model"
import { BuffSnapshotGitStrip } from "@/buff/snapshot-git"
import { BackgroundWorkSummary, type BackgroundTask } from "@/session/summary/background"
import { BuffContextChip } from "@/buff/context-chip"
import { BuffGitChip } from "@/buff/git-dialog"
import { BuffTrustStrip } from "@/buff/trust-strip"
import { BuffTodoBar } from "@/buff/todo-bar"
import { BuffGoalBar } from "@/buff/goal/goal-bar"
// Buff (#463): карточка плана в ленте регистрируется при загрузке.
import "@opencode/session-ui/buff-plan"
import { BuffTodo } from "@opencode/schema/buff-todo"
import { BuffRevertedStrip, BuffTurnSummary, createRevertConfirm } from "@/buff/turn-summary"
import { retryInput } from "@/buff/retry-turn"
import { BuffTurnFailure } from "@/buff/turn-failure"
import { useBuffText } from "@/buff/i18n"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"

export function createActiveSessionRegion(input: {
  session: SessionModel
  screen: SessionScreenLayout
  timeline: SessionTimelineInteraction
  visible: Accessor<boolean>
  // Buff (#449): открыть файл в панели изменений.
  openChangedFile?: (path: string) => void
}) {
  const command = useCommand()
  const data = useData()
  const dialog = useDialog()
  const language = useLanguage()
  const buffText = useBuffText()
  const local = useLocal()
  const location = useWorkspaceLocation()
  const navigate = useNavigate()
  const platform = usePlatform()
  const prompt = useComposerState()
  const state = createSessionRequestModel()
  const controls = createComposerControls({
    sessionKey: input.session.identity.sessionKey,
  })
  let promptRef: HTMLDivElement | undefined

  createEffect(
    on(
      () => [input.timeline.lastUserMessage(), input.session.data.info()] as const,
      () => {
        const message = input.timeline.lastUserMessage()
        const info = input.session.data.info()
        const selection = resolveSessionComposerSelection(info, message?.metadata)
        if (info && selection.agent && selection.model) {
          syncSessionModel(local, { sessionID: info.id, agent: selection.agent, model: selection.model })
        }
      },
    ),
  )
  createEffect(() => {
    const id = input.session.identity.params.id
    if (!id || !prompt.ready() || !local.session.ready()) return
    // Prompt model is a submission mirror. Local drafts and durable session state own selection.
    syncPromptModel(local, prompt)
  })
  createEffect(
    on(
      () => ({ directory: location().directory, id: input.session.identity.params.id }),
      (next, previous) => {
        if (!previous || (next.directory === previous.directory && next.id === previous.id)) return
        if (previous.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )

  const openAttachment: NonNullable<SessionUserActions["openAttachment"]> = (file) => {
    const url = file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`
    const download = () => {
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = getFilename(file.name) || "attachment"
      anchor.click()
    }
    const path = file.name ?? ""
    const absolute = path.startsWith("/") || path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path)
    if (!platform.revealPath || !absolute) return download()
    void platform.revealPath(path).then((revealed) => {
      if (!revealed) download()
    }, download)
  }
  const focus = () => {
    if (!input.session.data.isChild()) promptRef?.focus()
  }
  const openParent = () => {
    const id = input.session.data.parentID()
    if (id) navigate(sessionHref(requireServerKey(input.session.identity.params.serverKey), id))
  }
  const editable = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }
  const activeElement = () => {
    let current: Element | null = document.activeElement
    while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement
    }
    return current instanceof HTMLElement ? current : undefined
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const active = activeElement()
    if (
      path.some((item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null) ||
      editable(target) ||
      (active && (active.closest("[data-prevent-autofocus]") || editable(active))) ||
      dialog.active
    ) {
      return
    }
    if (event.key === "Escape" && input.session.data.isChild()) {
      event.preventDefault()
      openParent()
      return
    }
    if (active === promptRef) {
      if (event.key === "Escape") promptRef?.blur()
      return
    }
    const key = scrollKey(event)
    if (key) {
      const scroller = input.timeline.scroller()
      if (!scroller || !isScrollKeyTarget(target ?? null, key)) return
      if (scrollKeyOwner(scroller, target ?? null, key) !== scroller) return
      input.timeline.view.markUserScroll(scroller)
      return
    }
    if (event.key.length !== 1 || event.key === "Unidentified" || event.ctrlKey || event.metaKey) return
    if (state.blocked() || input.session.data.isChild() || !promptRef) return
    promptRef.focus()
    setCursorPosition(promptRef, prompt.cursor() ?? promptLength(prompt.current()))
  }
  onMount(() => makeEventListener(document, "keydown", handleKeyDown))
  const revert = createSessionRevert({
    session: input.session,
    setActiveMessage: input.timeline.actions.setActiveMessage,
    // Buff (#449): откат сначала показывает, что вернётся, и спрашивает.
    confirm: createRevertConfirm({
      sessionID: () => input.session.identity.sessionID(),
      directory: () => location().directory,
    }),
  })
  const revertMessage: NonNullable<SessionUserActions["revert"]> = ({ messageID }) => revert.to(messageID)
  // Buff (#458): «Повторить» отправляет то же сообщение ещё раз.
  const retryTurn = async (userMessageID: string) => {
    const sessionID = input.session.identity.sessionID()
    const message = sessionID
      ? data.session.message.list(sessionID).find((item) => item.id === userMessageID)
      : undefined
    if (!sessionID || message?.type !== "user") return
    await data.session
      .prompt(retryInput(sessionID, message))
      .catch((error: unknown) =>
        showToast({ title: buffText.t("Could not retry"), description: formatServerError(error, language.t) }),
      )
  }
  useComposerCommands()
  useSessionCommands({
    session: input.session,
    background: {
      blocking: () => state.background.blocking().length > 0,
      move: state.background.move,
    },
    navigateMessageByOffset: input.timeline.actions.navigateMessage,
    revert,
    focusInput: focus,
  })
  command.register("session-palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: () => command.trigger("file.open", "palette"),
    },
  ])

  const dock = {
    state,
    parentID: input.session.data.parentID,
    centered: input.screen.centered,
    onResponseSubmit: input.timeline.actions.resume,
    openParent,
    setPromptRef: (element: HTMLDivElement) => {
      promptRef = element
    },
    setDockRef: input.timeline.view.setDockRef,
  }
  const active = createMemo(
    on(
      () => (input.visible() ? input.session.identity.sessionID() : undefined),
      (sessionID) => (sessionID ? createSessionComposerController({ sessionID, controls, dock }) : undefined),
    ),
  )

  return {
    active,
    drop: {
      active: () => active()?.drop.active() ?? false,
      input: () => active()?.drop.input(),
    },
    actions: {
      timeline: {
        get revert() {
          if (input.session.data.isChild()) return
          return revertMessage
        },
        openAttachment,
        // Buff (#458): отказ хода — карточкой с причиной и действиями.
        turnFailure: (failure) => (
          <BuffTurnFailure failure={failure} onRetry={() => retryTurn(failure.userMessageID)} />
        ),
        // Buff (#449): под ответом — какие файлы ход изменил, с откатом.
        turnSummary: ({ userMessageID }) => (
          <Show when={!input.session.data.isChild() && input.session.identity.sessionID()}>
            {(sessionID) => (
              <BuffTurnSummary
                sessionID={sessionID()}
                userMessageID={userMessageID}
                onOpenFile={(path) => input.openChangedFile?.(path)}
                onRevert={() => void revert.to(userMessageID)}
              />
            )}
          </Show>
        ),
      } satisfies SessionUserActions,
    },
    requests: state,
    // Buff (#463): цель сессии и строка прогресса списка дел над полем ввода.
    sessionID: () => input.session.identity.params.id,
    todos: () => {
      const id = input.session.identity.params.id
      return id ? BuffTodo.latest(data.session.message.list(id) ?? []) : undefined
    },
    // Buff (#449): строка «ход откачен» над полем ввода.
    reverted: {
      files: () => {
        const staged = input.session.data.info()?.revert
        return staged ? (staged.files?.length ?? 0) : undefined
      },
      redo: () => void revert.redo(),
    },
    workspaceMoveEligible: () => true,
  }
}

export type ActiveSessionRegionModel = ReturnType<typeof createActiveSessionRegion>

export function ActiveSessionComposerRegion(props: {
  model: SessionComposerController
  // Buff (#449): строка «ход откачен» над полем ввода.
  reverted?: ActiveSessionRegionModel["reverted"]
  // Buff (#456): фоновая работа — под полем ввода, пока она есть, а не только в сводке сессии.
  backgroundTasks?: BackgroundTask[]
  // Buff (#463): последний список дел сессии и сессия — для её цели.
  todos?: readonly BuffTodo.Item[]
  sessionID?: string
}) {
  return (
    <SessionComposerRegion
      controller={props.model.region}
      composer={
        <div class="relative">
          <SessionQueuePanel queue={props.model.queue} />
          <div class="relative z-10">
            <BuffGoalBar session={props.sessionID} />
            <BuffTodoBar items={props.todos} />
            <BuffTrustStrip />
            <BuffNoModelStrip />
            <BuffFundsStrip />
            <BuffSnapshotGitStrip />
            <BuffRevertedStrip files={props.reverted?.files()} onRedo={() => props.reverted?.redo()} />
            <Composer model={props.model.composer} borderUnderlay />
            <div class="flex min-h-7 flex-wrap justify-start">
              <BuffContextChip />
              <BuffGitChip />
              <span class="buff-bg-chip">
                <BackgroundWorkSummary tasks={props.backgroundTasks ?? []} mobile />
              </span>
              <span class="ms-auto">
                <BuffBalanceChip />
              </span>
            </div>
          </div>
        </div>
      }
    />
  )
}
