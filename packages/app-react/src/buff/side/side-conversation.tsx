// A side conversation in a tab of the side panel (#464), like ZCode: a branch of the main session —
// what was said after it opened, an input, «Full screen». A fragment selected in an answer goes to
// the main conversation as a quote (through `onQuote`, which the composer wires). The main session
// does not change. Ported from the Solid window's buff/side/side-conversation.tsx; requests of the
// side session are answered in its full-screen view (the docks belong to the session screen).

import { Button, EmptyState, Textarea } from "@buff/ui/react"
import { sessionFormRequest, sessionPermissionRequest } from "@opencode/app/react-reuse/session-request-tree"
import { sideRows } from "@opencode/app/react-reuse/side-rows"
import { BuffSide } from "@opencode/schema/buff-side"
import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import { useStore } from "../../react/use-store"
import { useSessionViewed } from "../../shell/notifications/provider"
import { showToast } from "../../shell/notifications/toast"
import { PermissionDock } from "../../session/docks/permission-dock"
import { QuestionDock } from "../../session/docks/question-dock"
import { answerSelection } from "../answer-selection"
import { Markdown } from "../../session/timeline/markdown/markdown"
import { useOpenSession } from "../page"
import { setSideDraft, sideDrafts } from "./drafts"

const TEXT = '[data-component="buff-side-text"]'

export function SideConversation(props: {
  server: Server
  session: string
  main: string
  directory: string
  /** Put a quote into the main session's prompt. */
  onQuote?: (text: string) => void
}) {
  const t = useI18n().buff.t
  const openSession = useOpenSession()
  const data = props.server.data
  const sides = useQuery({
    queryKey: ["buff-sides", props.server.key, props.main],
    queryFn: () =>
      props.server
        .api()
        .rpc(BuffSide.Rpc)
        .list({ session: props.main }, { location: { directory: props.directory } })
        .then((result) => result.sides),
  })
  const since = sides.data?.find((side) => side.id === props.session)?.at ?? 0
  const messages = useServerData(props.server, (state) => state.session.message[props.session])
  const title = useServerData(props.server, (state) => state.session.info[props.session]?.title)
  const running = useServerData(props.server, (state) => state.session.active[props.session] === "running")
  const permission = useServerData(props.server, (state) =>
    sessionPermissionRequest(Object.values(state.session.info), (id) => state.session.permission[id], props.session),
  )
  const question = useServerData(props.server, (state) =>
    sessionFormRequest(Object.values(state.session.info), (id) => state.session.form[id], props.session),
  )
  const [responding, setResponding] = useState(false)
  const draft = useStore(sideDrafts, (all) => all[props.session] ?? "")
  const [offer, setOffer] = useState<{ text: string; rect: DOMRect }>()
  const rows = sideRows(messages ?? [], since)
  // #470: an answer shown here is read — the session list does not keep it «Unread».
  useSessionViewed(props.server.key, props.session)

  useEffect(() => {
    void Promise.all([
      data.session.sync(props.session),
      data.session.message.sync(props.session),
      data.session.permission.sync(props.session),
      data.session.form.sync(props.session),
    ]).catch(() => undefined)
    const update = () => setOffer(answerSelection(window.getSelection(), TEXT))
    document.addEventListener("selectionchange", update)
    return () => document.removeEventListener("selectionchange", update)
  }, [props.server, props.session])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setSideDraft(props.session, "")
    void props.server
      .api()
      .session.prompt({ sessionID: props.session, text })
      .catch((error: unknown) => {
        setSideDraft(props.session, text)
        showToast({
          title: t("Side conversation"),
          description: error instanceof Error ? error.message : t("The message was not sent."),
        })
      })
  }
  const decide = (response: "once" | "always" | "reject", message?: string) => {
    if (!permission) return
    setResponding(true)
    void props.server
      .api()
      .permission.reply({
        sessionID: permission.sessionID,
        requestID: permission.id,
        decision: response,
        ...(message ? { message } : {}),
      })
      .catch(() => undefined)
      .finally(() => setResponding(false))
  }
  const toMain = () => {
    if (!offer || !props.onQuote) return
    props.onQuote(offer.text)
    window.getSelection()?.removeAllRanges()
    showToast({
      title: t("To the main conversation"),
      description: t("The fragment is in the input of the main session."),
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2" data-component="buff-side-conversation">
      <div className="flex items-center gap-2">
        <span className="ui-title ui-title--sm min-w-0 flex-1 truncate">{title ?? t("Side conversation")}</span>
        <Button
          size="sm"
          variant="ghost"
          data-action="buff-side-full"
          onClick={() => openSession(props.server, props.session)}
        >
          {t("Full screen")}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 select-text flex-col gap-3 overflow-y-auto" data-component="buff-side-messages">
        {!rows.length && (
          <EmptyState inline>
            {t(
              "The side conversation sees the whole main session, but the main one does not see it. Ask here without derailing the main task.",
            )}
          </EmptyState>
        )}
        {rows.map((row) => (
          <div key={row.id} className="flex flex-col gap-1" data-role={row.role}>
            {row.tools.length > 0 && (
              <span className="ui-hint">{t("Tools: {tools}", { tools: row.tools.join(", ") })}</span>
            )}
            {row.text && (
              <div className={row.role === "user" ? "self-end" : undefined} data-component="buff-side-text">
                <Markdown text={row.text} cacheKey={`buff-side:${row.id}`} />
              </div>
            )}
          </div>
        ))}
        {running && <span className="ui-hint">{t("Answering…")}</span>}
      </div>
      {permission && (
        <PermissionDock
          key={permission.id}
          request={permission}
          responding={responding}
          subagent={permission.sessionID !== props.session}
          onDecide={decide}
        />
      )}
      {question && <QuestionDock key={question.id} request={question} onSubmit={() => undefined} />}
      <div className="flex items-end gap-2">
        <Textarea
          rows={2}
          className="flex-1"
          data-component="buff-side-input"
          aria-label={t("Side conversation")}
          placeholder={t("Ask in the side conversation… Enter — send, Shift+Enter — new line")}
          value={draft}
          onChange={(event) => setSideDraft(props.session, event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            send()
          }}
        />
        {running ? (
          <Button
            size="sm"
            data-action="buff-side-stop"
            onClick={() =>
              void props.server
                .api()
                .session.interrupt({ sessionID: props.session })
                .catch(() => undefined)
            }
          >
            {t("Stop")}
          </Button>
        ) : (
          <Button size="sm" variant="primary" data-action="buff-side-send" onClick={send}>
            {t("Send")}
          </Button>
        )}
      </div>
      {offer &&
        props.onQuote &&
        createPortal(
          <div
            className="fixed z-50"
            style={{ top: Math.max(8, offer.rect.top - 40), left: Math.max(8, offer.rect.left) }}
          >
            <Button
              size="sm"
              variant="primary"
              leadingIcon={Plus}
              data-action="buff-side-to-main"
              onMouseDown={(event) => event.preventDefault()}
              onClick={toMain}
            >
              {t("To the main conversation")}
            </Button>
          </div>,
          document.body,
        )}
    </div>
  )
}
