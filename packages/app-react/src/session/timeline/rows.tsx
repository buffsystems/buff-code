// The session timeline's rows (#584), ported from session-ui's createSessionTimelineRowRenderer.
// A row is memoised on its projection row object, which the projection keeps while the row's
// structure is unchanged; its live content comes from narrow selectors on the server's data.

import type {
  ModelRef,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client/promise"
import { Tooltip } from "@buff/ui/react"
import { parseCommentNote, readPromptPresentation } from "@opencode/app/react-reuse/comment-note"
import { currentContentDefaultOpen, currentToolFailed } from "@opencode/session-ui/current-tool-state"
import { noticeSummary } from "@opencode/session-ui/timeline/buff-notice"
import { personShellOnly } from "@opencode/session-ui/timeline/buff-person-shell"
import { timelineCategory } from "@opencode/session-ui/timeline/detail"
import {
  Timeline,
  TimelineRow,
  unwrapErrorMessage,
  type PartRef,
} from "@opencode/session-ui/timeline/projection"
import { memo, useMemo, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { locationKey, type DataState } from "../../core/data/state"
import { useI18n } from "../../i18n/provider"
import { shallowEqual, useStore } from "../../react/use-store"
import {
  findMessage,
  messageIndex,
  useBusy,
  useContent,
  useDisclosure,
  useMessage,
  useProjection,
  useTimeline,
  type TimelineContextValue,
} from "./context"
import { reasoningMode } from "./projection"
import { CompactionMessage } from "./parts/compaction"
import { SessionError, SessionRetry, TimelineSeparator } from "./parts/status"
import { AssistantReasoning, AssistantText } from "./parts/text"
import { UserMessage } from "./parts/user-message"
import { ContextToolGroup, FileToolGroup, ShellMessage, ToolDisplay } from "./tools/tool-display"
import type { ContextGroupPart } from "./tools/types"
import {
  currentToolError,
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
} from "@opencode/session-ui/current-tool-state"

type Content = SessionMessageAssistant["content"][number]
type FramedRow = Exclude<TimelineRow.TimelineRow, TimelineRow.TurnGap>

/** One timeline row; `onSizeChange` asks the virtualizer to measure it after async content. */
export const TimelineRowView = memo(function TimelineRowView(props: {
  row: TimelineRow.TimelineRow
  onSizeChange?: () => void
}) {
  const row = props.row
  if (row._tag === "TurnGap") return <div data-timeline-row="TurnGap" aria-hidden="true" className="h-6" />
  if (row._tag === "UserMessage") return <UserMessageRow row={row} />
  if (row._tag === "Shell")
    return (
      <Frame row={row}>
        <Shell messageID={row.messageID} />
      </Frame>
    )
  if (row._tag === "Notice")
    return (
      <Frame row={row}>
        <Notice messageID={row.messageID} onSizeChange={props.onSizeChange} />
      </Frame>
    )
  if (row._tag === "TurnDivider") return <TurnDivider row={row} />
  if (row._tag === "AssistantPart") return <AssistantPartRow row={row} onSizeChange={props.onSizeChange} />
  if (row._tag === "Thinking") return <ThinkingRow row={row} onSizeChange={props.onSizeChange} />
  if (row._tag === "Retry") return <RetryRow row={row} />
  return <ErrorRow row={row} />
})

function Frame(props: { row: FramedRow; children: ReactNode }) {
  const timeline = useTimeline()
  const row = props.row
  const spacing = row._tag === "AssistantPart" ? row.spacing : undefined
  return (
    <div
      id={row._tag === "UserMessage" ? timeline.anchor(row.userMessageID) : undefined}
      data-message-id={row.userMessageID}
      data-timeline-row={row._tag}
      data-timeline-spacing={spacing}
      className={`timeline-row ${timeline.centered ? "timeline-row--centered" : ""} ${spacing === "tool" ? "pt-2" : spacing === "content" ? "pt-4" : ""}`}
    >
      <div data-component="session-turn" className="relative w-full min-w-0">
        {props.children}
      </div>
    </div>
  )
}

function Container(props: { children: ReactNode; grouped?: boolean; className?: string }) {
  return (
    <div
      data-slot="session-turn-message-container"
      className={`w-full ${props.grouped ? "" : "timeline-inset"} ${props.className ?? ""}`}
    >
      {props.children}
    </div>
  )
}

/** The display name of a model from the session location's catalog, or its id. */
export function useModelName(model: ModelRef | undefined) {
  const timeline = useTimeline()
  return useStore(timeline.server.data.state, (state) => {
    if (!model?.id) return ""
    return modelName(state, timeline.sessionID, model) ?? model.id
  })
}

function modelName(state: DataState, sessionID: string, model: ModelRef) {
  const location = state.session.info[sessionID]?.location ?? state.defaultLocation
  return state.location[locationKey(location)]?.model?.find(
    (item) => item.providerID === model.providerID && (item.id === model.id || item.modelID === model.id),
  )?.name
}

function UserMessageRow(props: { row: TimelineRow.UserMessage }) {
  const timeline = useTimeline()
  const message = useMessage(props.row.userMessageID)
  const context = useProjection((projection) => projection.userContextByID.get(props.row.userMessageID))
  const model = context?.model
  const name = useModelName(model)
  const presentation = useMemo(() => {
    if (message?.type !== "user") return
    const value = readPromptPresentation(message.metadata)
    const parsed = value ? undefined : parseCommentNote(message.text)
    return {
      text: value?.displayText ?? message.text,
      comments: value?.comments ?? (parsed ? [parsed] : []),
      references: value?.attachments ?? [],
    }
  }, [message])
  return (
    <Frame row={props.row}>
      {message?.type === "user" && presentation && (
        <Container>
          <div data-slot="session-turn-message-content" aria-live="off">
            <UserMessage
              sessionID={timeline.sessionID}
              message={message}
              text={presentation.text}
              comments={presentation.comments}
              references={presentation.references}
              agent={context?.agent ?? ""}
              model={model ?? { id: "", providerID: "" }}
              modelName={name}
            />
          </div>
        </Container>
      )}
    </Frame>
  )
}

function TurnDivider(props: { row: TimelineRow.TurnDivider }) {
  const i18n = useI18n()
  return (
    <Frame row={props.row}>
      <Container>
        <div data-slot="session-turn-compaction">
          <div className="py-2">
            <TimelineSeparator label={i18n.t("ui.message.interrupted")} />
          </div>
        </div>
      </Container>
    </Frame>
  )
}

function capitalizeAgent(agent: string) {
  return agent.slice(0, 1).toUpperCase() + agent.slice(1)
}

type NoticeContent = { label: string; data?: string; items?: string[] }

function useNoticeContent() {
  const i18n = useI18n()
  return (message: SessionMessageInfo): NoticeContent | undefined => {
    if (message.type === "agent-switched")
      return {
        label: i18n.t("ui.sessionTimeline.notice.agentChanged"),
        data: message.previous
          ? `${capitalizeAgent(message.previous)} → ${capitalizeAgent(message.agent)}`
          : capitalizeAgent(message.agent),
      }
    if (message.type === "model-switched") return undefined
    if (message.type === "skill") return { label: i18n.t("ui.tool.skill"), data: message.name }
    if (message.type === "system") {
      const prefix = "Instructions updated: "
      if (message.description?.startsWith(prefix))
        return {
          label: i18n.t("ui.sessionTimeline.notice.instructionsUpdated"),
          items: message.description
            .slice(prefix.length)
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        }
      return { label: message.description ?? message.text }
    }
    if (message.type !== "synthetic") return undefined
    if (message.description === "Continuing after restart") return { label: message.description }
    const source = typeof message.metadata?.source === "string" ? message.metadata.source : undefined
    const state = typeof message.metadata?.state === "string" ? message.metadata.state : undefined
    if (source === "subagent" || source === "shell") {
      const agent = typeof message.metadata?.agent === "string" ? message.metadata.agent : undefined
      const actor = source === "shell" ? i18n.t("ui.tool.shell") : (agent ?? i18n.t("ui.tool.agent.default"))
      return {
        label: i18n.t(
          state === "error"
            ? "ui.sessionTimeline.notice.failed"
            : state === "cancelled"
              ? "ui.sessionTimeline.notice.cancelled"
              : "ui.sessionTimeline.notice.finished",
          { actor },
        ),
        data: message.description,
      }
    }
    return { label: message.description ?? message.text, data: noticeSummary(message.metadata) }
  }
}

function Notice(props: { messageID: string; grouped?: boolean; onSizeChange?: () => void }) {
  const i18n = useI18n()
  const timeline = useTimeline()
  const message = useMessage(props.messageID)
  const notice = useNoticeContent()
  const modelSwitch = message?.type === "model-switched" ? message.model : undefined
  const modelLabel = useModelName(modelSwitch)
  const inset = props.grouped ? "" : "timeline-inset"
  if (!message) return null
  if (message.type === "compaction")
    return (
      <div data-slot="session-turn-message-container" className={`w-full ${inset}`}>
        <div data-slot="session-turn-compaction">
          <CompactionMessage
            message={message}
            error={message.status === "failed" ? unwrapErrorMessage(message.error.message) : ""}
            onRendered={props.onSizeChange}
          />
        </div>
      </div>
    )
  if (message.type === "location-switched")
    return (
      <div
        data-slot="session-timeline-notice"
        data-type="location-switched"
        className={`timeline-notice timeline-notice--moved ${inset}`}
      >
        <Tooltip content={i18n.t("ui.sessionTimeline.notice.movedTooltip")}>
          <bdi data-slot="session-timeline-notice-label" dir="auto" tabIndex={0} className="font-medium">
            {i18n.t("ui.sessionTimeline.notice.movedTo")}
          </bdi>
        </Tooltip>{" "}
        <bdi data-slot="session-timeline-notice-value" dir="ltr" className="min-w-0 truncate">
          {message.location.directory}
        </bdi>
      </div>
    )
  if (modelSwitch)
    return (
      <div data-slot="session-timeline-notice" data-type="model-switched" className={`w-full py-2 ${inset}`}>
        <TimelineSeparator
          label={i18n.t("ui.sessionTimeline.notice.modelSwitched", { model: modelLabel || modelSwitch.id })}
          providerID={modelSwitch.providerID}
          variant={modelSwitch.variant}
        />
      </div>
    )
  const content = notice(message)
  if (!content) return null
  if (content.items?.length)
    return (
      <div data-slot="session-timeline-notice" className={`w-full py-1 ${inset}`}>
        <div className="timeline-notice timeline-notice--items">
          <bdi dir="auto" className="shrink-0 font-medium">
            {content.label}
          </bdi>
          {content.items.map((item) => (
            <bdi key={item} dir="auto" className="min-w-0 truncate">
              {item}
            </bdi>
          ))}
        </div>
      </div>
    )
  const childID =
    message.type === "synthetic" && message.metadata?.source === "subagent" && typeof message.metadata.childID === "string"
      ? message.metadata.childID || undefined
      : undefined
  const href = childID ? timeline.actions.sessionHref?.(childID) : undefined
  const clickable = !!childID && !!(timeline.actions.navigateToSession || href)
  const open = () => {
    if (childID) timeline.actions.navigateToSession?.(childID)
  }
  const navigate = (event: MouseEvent) => {
    if (!childID || !timeline.actions.navigateToSession) return
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    event.preventDefault()
    open()
  }
  const navigateKey = (event: KeyboardEvent) => {
    if (!clickable || href) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    open()
  }
  const Tag = href ? "a" : "div"
  return (
    <Tag
      data-slot="session-timeline-notice"
      className={`timeline-notice text-text-weak ${props.grouped ? "py-1" : "pt-3 pb-1"} ${clickable ? "cursor-pointer" : ""} ${inset}`}
      href={href}
      role={clickable && !href ? "link" : undefined}
      tabIndex={clickable && !href ? 0 : undefined}
      onClick={navigate}
      onKeyDown={navigateKey}
    >
      <bdi dir="auto" className={`font-medium ${message.type === "agent-switched" ? "timeline-faint" : ""}`}>
        {content.label}
      </bdi>
      {content.data && (
        <span className={message.type === "agent-switched" ? "ms-2" : undefined}>
          {message.type !== "agent-switched" && " · "}
          <bdi dir="auto">{content.data}</bdi>
        </span>
      )}
    </Tag>
  )
}

function Shell(props: { messageID: string; grouped?: boolean }) {
  const message = useMessage(props.messageID)
  const [open, setOpen] = useDisclosure(props.messageID)
  if (message?.type !== "shell") return null
  return (
    <Container grouped={props.grouped}>
      {/* Buff (#470): a command the person ran ("!") shows with its output, open at once. */}
      <ShellMessage message={message} defaultOpen open={open ?? true} onOpenChange={setOpen} />
    </Container>
  )
}

function contentDefaultOpen(timeline: TimelineContextValue, item: Content) {
  const detail = timeline.detail
  const category = timelineCategory(item)
  if (category && detail[category].placement === "hidden" && item.type === "tool" && currentToolFailed(item))
    return true
  if (category === "shell" || category === "edit" || category === "thinking")
    return detail[category].details === "expanded"
  if (item.type === "reasoning") return reasoningMode(detail) === "full"
  return currentContentDefaultOpen(item, detail.shell.details === "expanded", detail.edit.details === "expanded")
}

// The latest answer text of a finished turn carries the turn's copy action and meta.
function useCopyContentID(userMessageID: string) {
  const busy = useBusy()
  const active = useProjection((projection) => projection.activeMessageID)
  const messages = useProjection((projection) => projection.assistantMessagesByParent.get(userMessageID))
  if (busy && active === userMessageID) return null
  const message = messages?.findLast((item) =>
    item.content.some((content) => content.type === "text" && !!content.text.trim()),
  )
  return message
    ? Timeline.contentEntries(message).findLast((entry) => entry.content.type === "text" && !!entry.content.text.trim())
        ?.id
    : undefined
}

function useTurnDuration(userMessageID: string) {
  const user = useMessage(userMessageID)
  const messages = useProjection((projection) => projection.assistantMessagesByParent.get(userMessageID))
  if (user?.type !== "user") return null
  const completed = (messages ?? []).reduce<number | undefined>((latest, message) => {
    if (message.time.completed === undefined) return latest
    return latest === undefined ? message.time.completed : Math.max(latest, message.time.completed)
  }, undefined)
  if (completed === undefined || completed < user.time.created) return undefined
  return completed - user.time.created
}

function useWorkingTurn(userMessageID: string) {
  const busy = useBusy()
  const active = useProjection((projection) => projection.activeMessageID)
  return busy && active === userMessageID
}

function AssistantPartRow(props: { row: TimelineRow.AssistantPart; onSizeChange?: () => void }) {
  const working = useWorkingTurn(props.row.userMessageID)
  const group = props.row.group
  return (
    <Frame row={props.row}>
      <Container>
        <div data-slot="session-turn-assistant-content" aria-hidden={working || undefined}>
          {group.type === "context" ? (
            <ContextGroup row={props.row} refs={group.refs} onSizeChange={props.onSizeChange} />
          ) : group.type === "file" ? (
            <FileGroup groupKey={group.key} refs={group.refs} onSizeChange={props.onSizeChange} />
          ) : (
            <AssistantPart row={props.row} partRef={group.ref} onSizeChange={props.onSizeChange} />
          )}
        </div>
      </Container>
    </Frame>
  )
}

// Metadata of the message that owns a part: its identity changes with a delta of any sibling
// part, so rows compare only the fields they show.
function sameMeta(previous: SessionMessageAssistant | undefined, next: SessionMessageAssistant | undefined) {
  if (previous === next) return true
  if (!previous || !next) return false
  return (
    previous.time === next.time &&
    previous.error === next.error &&
    previous.agent === next.agent &&
    previous.model === next.model &&
    previous.retry === next.retry
  )
}

function useAssistantMeta(messageID: string) {
  const timeline = useTimeline()
  return useStore(
    timeline.server.data.state,
    (state) => {
      const message = findMessage(state, timeline.sessionID, messageID)
      return message?.type === "assistant" ? message : undefined
    },
    sameMeta,
  )
}

function AssistantPart(props: { row: TimelineRow.AssistantPart; partRef: PartRef; onSizeChange?: () => void }) {
  const timeline = useTimeline()
  const message = useAssistantMeta(props.partRef.messageID)
  const content = useContent(props.partRef)
  const copyID = useCopyContentID(props.row.userMessageID)
  const duration = useTurnDuration(props.row.userMessageID)
  const modelName = useModelName(message?.model)
  const disclosureKey = content?.type === "reasoning" ? props.partRef.partID : props.row.group.key
  const [open, setOpen] = useDisclosure(disclosureKey)
  if (!message || !content) return null
  const defaultOpen = contentDefaultOpen(timeline, content)
  const summary = timeline.actions.turnSummary
  return (
    <>
      {content.type === "text" ? (
        <AssistantText
          id={props.partRef.partID}
          text={content.text}
          message={message}
          modelName={modelName}
          showCopy={copyID === props.partRef.partID}
          turnDurationMs={duration}
          onRendered={props.onSizeChange}
        />
      ) : content.type === "reasoning" ? (
        <AssistantReasoning
          id={props.partRef.partID}
          content={content}
          streaming={false}
          open={open ?? defaultOpen}
          onOpenChange={setOpen}
          onContentRendered={props.onSizeChange}
        />
      ) : (
        <ToolDisplay
          id={props.partRef.partID}
          tool={content.name}
          input={currentToolInput(content)}
          metadata={currentToolMetadata(content)}
          output={currentToolOutput(content)}
          status={content.state.status}
          error={currentToolError(content)}
          defaultOpen={defaultOpen}
          open={open ?? defaultOpen}
          onOpenChange={setOpen}
          deferContent
          virtualizeDiff={false}
          onContentRendered={props.onSizeChange}
        />
      )}
      {summary && copyID === props.partRef.partID && summary({ userMessageID: props.row.userMessageID })}
    </>
  )
}

// The live contents of a group's refs, compared item by item so an unrelated delta keeps them.
function useGroupContents(refs: PartRef[]) {
  const timeline = useTimeline()
  return useStore(
    timeline.server.data.state,
    (state) => {
      const index = messageIndex(state.session.message[timeline.sessionID])
      return refs.map((ref) => {
        const message = index.get(ref.messageID)
        return { ref, message, content: Timeline.resolveContent(message, ref.partID) }
      })
    },
    (previous, next) =>
      previous.length === next.length &&
      previous.every(
        (item, index) =>
          item.ref === next[index]!.ref && item.content === next[index]!.content && (item.content || item.message === next[index]!.message),
      ),
  )
}

function ContextGroup(props: { row: TimelineRow.AssistantPart; refs: PartRef[]; onSizeChange?: () => void }) {
  const timeline = useTimeline()
  const notice = useNoticeContent()
  const busy = useBusy()
  const working = useWorkingTurn(props.row.userMessageID)
  const lastGroup = useProjection((projection) => projection.lastAssistantGroupKey.get(props.row.userMessageID))
  const lastAssistant = useStore(
    timeline.server.data.state,
    (state) => lastAssistantState(state, timeline, props.row.userMessageID),
    shallowEqual,
  )
  const items = useGroupContents(props.refs)
  const key = `context:${props.row.group.key}`
  const [stored, setOpen] = useDisclosure(key)
  const disclosure = useStore(timeline.disclosure.store, (state) => state)
  const parts = items.flatMap<ContextGroupPart>((item) => {
    const content = item.content
    if (content?.type === "tool") return [content]
    if (content?.type === "reasoning")
      return [
        {
          ...content,
          id: item.ref.partID,
          streaming:
            working &&
            busy &&
            lastAssistant.id === item.ref.messageID &&
            lastAssistant.open &&
            lastAssistant.last === content &&
            content.time?.completed === undefined,
        },
      ]
    const message = item.message
    if (item.ref.messageID !== item.ref.partID || !message) return []
    if (message.type === "shell")
      return [{ type: "shell", id: item.ref.partID, render: () => <Shell messageID={item.ref.messageID} grouped /> }]
    if (message.type !== "assistant" && message.type !== "user")
      return [
        {
          type: "notice",
          id: item.ref.partID,
          title: notice(message)?.label,
          render: () => <Notice messageID={item.ref.messageID} grouped onSizeChange={props.onSizeChange} />,
        },
      ]
    return []
  })
  const patchGroupKeys = timeline.disclosure.patchGroupKeys
  const toolKey = (tool: SessionMessageAssistantTool) =>
    `${items.find((item) => item.content === tool)?.ref.messageID}:${tool.id}`
  return (
    <ContextToolGroup
      parts={parts}
      patchGroupKey={(tools) => {
        const keys = tools.map(toolKey)
        const owners = patchOwners(timeline, items)
        // After a split, only the subgroup with the earliest surviving member keeps the old anchor.
        const anchor =
          keys.map((part) => patchGroupKeys.get(part)).find((value) => value !== undefined && keys.includes(owners.get(value)!)) ??
          keys[0]!
        keys.forEach((part) => patchGroupKeys.set(part, anchor))
        return anchor
      }}
      reasoningDefaultOpen={timeline.detail.thinking.details === "expanded"}
      reasoningOpen={(id) => disclosure[id]}
      onReasoningOpenChange={(id, open) => timeline.disclosure.set(id, open)}
      toolDefaultOpen={(tool) => contentDefaultOpen(timeline, tool)}
      toolOpen={(id) => disclosure[`${props.row.group.key}:tool:${id}`]}
      onToolOpenChange={(id, open) => timeline.disclosure.set(`${props.row.group.key}:tool:${id}`, open)}
      fileOpen={(path) => disclosure[`patch:${path}`] ?? timeline.detail.edit.details === "expanded"}
      onFileOpenChange={(path, open) => timeline.disclosure.set(`patch:${path}`, open)}
      open={(stored ?? personShellOnly(parts)) === true}
      busy={working && lastGroup === props.row.group.key}
      onOpenChange={setOpen}
      onSizeChange={props.onSizeChange}
    />
  )
}

// The turn's newest assistant message and whether its last part is still open.
function lastAssistantState(state: DataState, timeline: TimelineContextValue, userMessageID: string) {
  const messages = timeline.projection.get().assistantMessagesByParent.get(userMessageID)
  const id = messages?.at(-1)?.id
  const message = id ? findMessage(state, timeline.sessionID, id) : undefined
  if (message?.type !== "assistant") return { id: undefined, open: false, last: undefined }
  return {
    id,
    open: message.time.completed === undefined && !message.error && !message.retry,
    last: message.content.at(-1),
  }
}

// Track status changes before a group is first opened: a failed file change can split an
// existing group without changing the projection's row identities.
function patchOwners(
  timeline: TimelineContextValue,
  items: { ref: PartRef; content: Content | undefined }[],
) {
  const owners = new Map<string, string>()
  items.forEach((item) => {
    const content = item.content
    if (content?.type !== "tool" || !["edit", "write", "patch"].includes(content.name) || content.state.status === "error")
      return
    const part = `${item.ref.messageID}:${item.ref.partID}`
    const key = timeline.disclosure.patchGroupKeys.get(part)
    if (key && !owners.has(key)) owners.set(key, part)
  })
  return owners
}

function FileGroup(props: { groupKey: string; refs: PartRef[]; onSizeChange?: () => void }) {
  const timeline = useTimeline()
  const items = useGroupContents(props.refs)
  const disclosure = useStore(timeline.disclosure.store, (state) => state)
  const tools = items.flatMap((item) => (item.content?.type === "tool" ? [item.content] : []))
  return (
    <FileToolGroup
      tools={tools}
      fileOpen={(path) =>
        disclosure[`${props.groupKey}:file:${path}`] ?? timeline.detail.edit.details === "expanded"
      }
      onFileOpenChange={(path, open) => timeline.disclosure.set(`${props.groupKey}:file:${path}`, open)}
      onSizeChange={props.onSizeChange}
    />
  )
}

function ThinkingRow(props: { row: TimelineRow.Thinking; onSizeChange?: () => void }) {
  const timeline = useTimeline()
  const content = useContent(props.row.ref)
  const [open, setOpen] = useDisclosure(props.row.ref.partID)
  const expanded = timeline.detail.thinking.details === "expanded"
  return (
    <Frame row={props.row}>
      <Container>
        <div data-slot="session-turn-thinking-row">
          {content?.type === "reasoning" && (
            <AssistantReasoning
              id={props.row.ref.partID}
              content={content}
              streaming
              defaultOpen={expanded}
              open={open ?? expanded}
              onOpenChange={setOpen}
              onContentRendered={props.onSizeChange}
            />
          )}
        </div>
      </Container>
    </Frame>
  )
}

function RetryRow(props: { row: TimelineRow.Retry }) {
  const busy = useBusy()
  const active = useProjection((projection) => projection.activeMessageID)
  const timeline = useTimeline()
  const retry = useStore(timeline.server.data.state, (state) => {
    const id = timeline.projection.get().assistantMessagesByParent.get(props.row.userMessageID)?.at(-1)?.id
    const message = id ? findMessage(state, timeline.sessionID, id) : undefined
    return message?.type === "assistant" ? message.retry : undefined
  })
  const status = retry
    ? { type: "retry" as const, attempt: retry.attempt, message: retry.error.message, next: retry.at }
    : busy
      ? { type: "busy" as const }
      : { type: "idle" as const }
  return (
    <Frame row={props.row}>
      <Container>
        <SessionRetry status={status} show={active === props.row.userMessageID} />
      </Container>
    </Frame>
  )
}

function ErrorRow(props: { row: TimelineRow.Error }) {
  const timeline = useTimeline()
  const failure = timeline.actions.turnFailure
  return (
    <Frame row={props.row}>
      <Container>
        {failure && props.row.failure ? failure(props.row.failure) : <SessionError message={props.row.text} />}
      </Container>
    </Frame>
  )
}
