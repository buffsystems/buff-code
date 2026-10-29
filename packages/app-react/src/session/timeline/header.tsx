import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  InlineInput,
} from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { sessionTitle } from "@opencode/app/react-reuse/session-title"
import { timelineChildTitle } from "@opencode/app/react-reuse/timeline-projection"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { MoreHorizontal } from "lucide-react"
import { createContext, use, useEffect, useState, type ReactNode } from "react"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import { sessionHref } from "../../router/routes"
import { useNavigate } from "../../router/router"
import { showToast } from "../../shell/notifications/toast"

const noMessages: SessionMessageInfo[] = []

/** True around a title row shown while its transcript's first page loads. */
export const TitleLoadingContext = createContext(false)

/**
 * The session's title row at the top of the timeline (#584): the parent session for a subagent,
 * the title (renamed in place) and the session's menu, with the screen's project menu before them
 * and its own actions on the right.
 */
export function TimelineHeader(props: {
  server: Server
  sessionID: string
  /** Before the title: the session's project menu. */
  leading?: ReactNode
  actions?: ReactNode
  /** Under the title, held at the top with it: what the reader must see first (#640). */
  below?: ReactNode
}) {
  const i18n = useI18n()
  const navigate = useNavigate()
  const data = props.server.data
  const info = useServerData(props.server, (state) => state.session.info[props.sessionID])
  const parentID = info?.parentID
  const parent = useServerData(props.server, (state) => (parentID ? state.session.info[parentID] : undefined))
  const parentMessages = useServerData(props.server, (state) =>
    parentID ? (state.session.message[parentID] ?? noMessages) : noMessages,
  )
  const [title, setTitle] = useState({ editing: false, draft: "", pending: false })
  const [menu, setMenu] = useState({ open: false, rename: false, remove: false })
  const fallback = i18n.t("session.tab.session")
  const label = sessionTitle(info?.title) ?? fallback
  const description = parentMessages
    .map((message) => taskDescription(message, props.sessionID))
    .findLast((value): value is string => !!value)
  // While the transcript loads, the row names the session itself, as the Solid identity header
  // does; the parent's task description takes over once it is shown.
  const loading = use(TitleLoadingContext)
  const childTitle = loading
    ? label
    : timelineChildTitle({ parentID, taskDescription: description, title: label, fallback })

  // A subagent's title comes from its parent's task call; load the parent when it is missing.
  useEffect(() => {
    if (!parentID || description || data.session.message.list(parentID).length > 0) return
    void Promise.all([data.session.sync(parentID), data.session.message.sync(parentID)]).catch(() => undefined)
  }, [parentID, description, data])

  useEffect(() => {
    setTitle({ editing: false, draft: "", pending: false })
    setMenu({ open: false, rename: false, remove: false })
  }, [props.sessionID])

  const openEditor = () => {
    if (parentID) return
    setTitle({ editing: true, draft: label, pending: false })
  }
  const save = async (value: string) => {
    const next = value.trim()
    if (title.pending) return
    if (!next || next === label) return setTitle({ editing: false, draft: "", pending: false })
    setTitle({ editing: true, draft: next, pending: true })
    const done = await props.server
      .api()
      .session.update({ sessionID: props.sessionID, title: next })
      .then(() => true)
      .catch((error: unknown) => {
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: formatServerError(error, undefined, i18n.t("common.requestFailed")),
        })
        return false
      })
    if (!done) return setTitle({ editing: true, draft: next, pending: false })
    const current = data.session.get(props.sessionID)
    if (current) data.session.remember({ ...current, title: next })
    setTitle({ editing: false, draft: "", pending: false })
  }
  const remove = async () => {
    setMenu((current) => ({ ...current, remove: false }))
    const done = await props.server
      .api()
      .session.remove({ sessionID: props.sessionID })
      .then(() => true)
      .catch((error: unknown) => {
        showToast({
          variant: "error",
          title: i18n.t("session.delete.failed.title"),
          description: formatServerError(error, undefined, i18n.t("common.requestFailed")),
        })
        return false
      })
    if (done) navigate(parentID ? sessionHref(props.server.key, parentID) : "/")
  }

  return (
    <div data-session-title className="timeline-header">
      <div className="timeline-header__bar">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          {props.leading}
          {parentID && (
            <>
              <button
                type="button"
                data-slot="session-title-parent"
                className="timeline-header__parent"
                onClick={() => navigate(sessionHref(props.server.key, parentID))}
              >
                {sessionTitle(parent?.title) ?? fallback}
              </button>
              <span data-slot="session-title-separator" className="timeline-header__separator" aria-hidden="true">
                /
              </span>
            </>
          )}
          {title.editing ? (
            <InlineInput
              data-slot="session-title-child"
              bare
              dir="auto"
              autoFocus
              aria-label={i18n.t("common.rename")}
              defaultValue={title.draft}
              disabled={title.pending}
              className="timeline-header__title"
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => event.stopPropagation()}
              onCommit={(value) => void save(value)}
              onCancel={() => setTitle({ editing: false, draft: "", pending: false })}
            />
          ) : (
            childTitle && (
              <h1 data-slot="session-title-child" className="timeline-header__title" onClick={openEditor}>
                {childTitle}
              </h1>
            )
          )}
          {!parentID && (
            <DropdownMenu open={menu.open} onOpenChange={(open) => setMenu((current) => ({ ...current, open }))}>
              <DropdownMenuTrigger asChild>
                <IconButton icon={MoreHorizontal} size="xs" aria-label={i18n.t("common.moreOptions")} />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                // As wide as its longest label, as the Solid session options menu.
                className="w-max min-w-0"
                onCloseAutoFocus={(event) => {
                  if (!menu.rename) return
                  event.preventDefault()
                  setMenu((current) => ({ ...current, rename: false }))
                  openEditor()
                }}
              >
                <DropdownMenuItem onSelect={() => setMenu((current) => ({ ...current, rename: true }))}>
                  <span data-slot="menu-v2-item-content">{i18n.t("common.rename")}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator data-slot="menu-v2-separator" />
                <DropdownMenuItem destructive onSelect={() => setMenu((current) => ({ ...current, remove: true }))}>
                  <span data-slot="menu-v2-item-content">{i18n.t("common.delete")}…</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {props.actions}
          {/* Room for the panes' review toggle, which sits over this corner. */}
          <div className="size-7 shrink-0" aria-hidden="true" />
        </div>
      </div>
      {props.below}
      <ConfirmDialog
        open={menu.remove}
        danger
        title={i18n.t("session.delete.title")}
        message={i18n.t("session.delete.confirm", { name: label })}
        confirmLabel={i18n.t("session.delete.button")}
        cancelLabel={i18n.t("common.cancel")}
        onConfirm={() => void remove()}
        onCancel={() => setMenu((current) => ({ ...current, remove: false }))}
      />
    </div>
  )
}

// The task call that started a subagent session names it best.
function taskDescription(message: SessionMessageInfo, sessionID: string) {
  if (message.type !== "assistant") return
  const tool = message.content.findLast((item) => {
    if (item.type !== "tool" || (item.name !== "task" && item.name !== "subagent")) return false
    const metadata =
      item.state.status === "running" || item.state.status === "completed" ? item.state.metadata : undefined
    return metadata?.sessionId === sessionID || metadata?.sessionID === sessionID
  })
  if (tool?.type !== "tool" || typeof tool.state.input === "string") return
  const value = tool.state.input.description
  return typeof value === "string" && value ? value : undefined
}
