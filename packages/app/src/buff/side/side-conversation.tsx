import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { BuffSide } from "@opencode/schema/buff-side"
import { Button } from "@opencode/ui/button"
import { Markdown } from "@opencode/session-ui/markdown"
import { useComposerState } from "@/composer/persistence"
import { useServerSDK } from "@/runtime/server/client"
import { useData, useServer } from "@/runtime/server/current"
import { SessionPermissionDock } from "@/session/requests/session-permission-dock"
import { SessionQuestionDock } from "@/session/requests/session-question-dock"
import { sessionFormRequest, sessionPermissionRequest } from "@/session/requests/session-request-tree"
import { openNotificationSession, useNotification } from "@/shell/notifications/notification"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import { useWorkspaceLocation } from "@/workspaces/location"
import { answerSelection } from "../answer-quote"
import { useBuffText } from "../i18n"
import { chipPart } from "../attachment-prompt"
import { setSideDraft, sideDraft } from "./drafts"
import { sideRows } from "./rows"
import "./side-conversation.css"

/**
 * Побочный диалог во вкладке правой панели (#464), как в ZCode: ответвление основной сессии —
 * сказанное после открытия, поле ввода, разрешения и вопросы этой сессии, «Во весь экран».
 * Выделенное в ответе уходит в основной диалог цитатой. Основная сессия не меняется.
 */

const TEXT = '[data-component="buff-side-text"]'

export function SideConversation(props: { session: string; main: string }) {
  const sdk = useServerSDK()
  const data = useData()
  const location = useWorkspaceLocation()
  const mainPrompt = useComposerState()
  const tabs = useTabs()
  const server = useServer()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffSide.Rpc)
  const [sides] = createResource(
    () => props.main,
    (main) =>
      rpc.list({ session: main }, { location: { directory: location().directory } }).then((result) => result.sides),
  )
  const since = () => sides()?.find((side) => side.id === props.session)?.at ?? 0
  const rows = createMemo(() => sideRows(data.session.message.list(props.session) ?? [], since()))
  const running = () => data.session.status(props.session) === "running"
  const permission = createMemo(() =>
    sessionPermissionRequest(data.session.list(), data.session.permission.list, props.session),
  )
  const question = createMemo(() => sessionFormRequest(data.session.list(), data.session.form.list, props.session))
  const [responding, setResponding] = createSignal(false)
  const [offer, setOffer] = createSignal<{ text: string; rect: DOMRect }>()
  // #470: ответ, показанный здесь, прочитан — в колонке сессий не висит «Не прочитано».
  const notification = useNotification()
  createEffect(() => {
    if (!notification.ready() || notification.session.unseenCount(props.session) === 0) return
    notification.session.markViewed(props.session)
  })

  onMount(() => {
    void Promise.all([data.session.sync(props.session), data.session.message.sync(props.session)]).catch(
      () => undefined,
    )
    const update = () => setOffer(answerSelection(window.getSelection(), TEXT))
    document.addEventListener("selectionchange", update)
    onCleanup(() => document.removeEventListener("selectionchange", update))
  })

  const send = () => {
    const text = sideDraft(props.session).trim()
    if (!text) return
    setSideDraft(props.session, "")
    void sdk.api.session.prompt({ sessionID: props.session, text }).catch((error: unknown) => {
      setSideDraft(props.session, text)
      showToast({
        title: t("Side conversation"),
        description: error instanceof Error ? error.message : t("The message was not sent."),
      })
    })
  }
  const decide = (response: "once" | "always" | "reject", message?: string) => {
    const request = permission()
    if (!request) return
    setResponding(true)
    void sdk.api.permission
      .reply({
        sessionID: request.sessionID,
        requestID: request.id,
        decision: response,
        ...(message ? { message } : {}),
      })
      .finally(() => setResponding(false))
  }
  const toMain = () => {
    const current = offer()
    if (!current) return
    mainPrompt.set([...mainPrompt.current(), chipPart("quote", current.text, crypto.randomUUID())], mainPrompt.cursor())
    window.getSelection()?.removeAllRanges()
    showToast({ title: t("To the main conversation"), description: t("The fragment is in the input of the main session.") })
  }

  return (
    <div class="buff-side" data-component="buff-side-conversation">
      <div class="buff-side-head">
        <span class="buff-side-title">{data.session.get(props.session)?.title ?? t("Side conversation")}</span>
        <Button
          size="small"
          variant="ghost"
          data-action="buff-side-full"
          onClick={() => openNotificationSession(tabs, server.key, props.session)}
        >
          {t("Full screen")}
        </Button>
      </div>
      <div class="buff-side-messages" data-component="buff-side-messages">
        <Show
          when={rows().length}
          fallback={
            <p class="buff-side-empty">
              {t(
                "The side conversation sees the whole main session, but the main one does not see it. Ask here without derailing the main task.",
              )}
            </p>
          }
        >
          <For each={rows()}>
            {(row) => (
              <div class="buff-side-row" data-role={row.role}>
                <Show when={row.tools.length}>
                  <span class="buff-side-tools">{t("Tools: {tools}", { tools: row.tools.join(", ") })}</span>
                </Show>
                <Show when={row.text}>
                  <div data-component="buff-side-text">
                    <Markdown text={row.text} />
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
        <Show when={running()}>
          <span class="buff-side-tools">{t("Answering…")}</span>
        </Show>
      </div>
      <Show when={permission()} keyed>
        {(request) => <SessionPermissionDock request={request} responding={responding()} onDecide={decide} />}
      </Show>
      <Show when={question()} keyed>
        {(request) => <SessionQuestionDock request={request} onSubmit={() => undefined} />}
      </Show>
      <div class="buff-side-input">
        <textarea
          data-component="buff-side-input"
          placeholder={t("Ask in the side conversation… Enter — send, Shift+Enter — new line")}
          value={sideDraft(props.session)}
          onInput={(event) => setSideDraft(props.session, event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
            event.preventDefault()
            send()
          }}
        />
        <Show
          when={running()}
          fallback={
            <Button size="small" variant="contrast" data-action="buff-side-send" onClick={send}>
              {t("Send")}
            </Button>
          }
        >
          <Button
            size="small"
            variant="neutral"
            data-action="buff-side-stop"
            onClick={() => void sdk.api.session.interrupt({ sessionID: props.session }).catch(() => undefined)}
          >
            {t("Stop")}
          </Button>
        </Show>
      </div>
      <Show when={offer()}>
        {(current) => (
          <Portal>
            <div
              class="buff-answer-quote"
              style={{
                top: `${Math.max(8, current().rect.top - 40)}px`,
                left: `${Math.max(8, current().rect.left)}px`,
              }}
            >
              <Button
                size="small"
                variant="contrast"
                icon="plus"
                data-action="buff-side-to-main"
                onMouseDown={(event: MouseEvent) => event.preventDefault()}
                onClick={toMain}
              >
                {t("To the main conversation")}
              </Button>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  )
}
