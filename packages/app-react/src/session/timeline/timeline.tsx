// The session message timeline (#584): the Solid window's MessageTimeline on React. Three
// framework-free controllers own the work — the projection (rows from the server's data), the
// interaction (follow state, history paging) and the virtualizer (measurement and anchoring) —
// and React paints what they publish: a memoised row per projection row, positioned absolutely.

import { Timeline, type TimelineRow } from "@opencode/session-ui/timeline/projection"
import type { TimelineDetail } from "@opencode/session-ui/timeline/detail"
import { getReadyMarkdown, preloadMarkdown } from "./markdown/cache"
import { parseCommentNote, readPromptPresentation } from "@opencode/app/react-reuse/comment-note"
import { ArrowDown } from "lucide-react"
import "./timeline.css"
import { createPortal } from "react-dom"
import {
  createContext,
  memo,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { VirtualItem } from "@tanstack/virtual-core"
import type { Server } from "../../core/servers"
import type { DataState } from "../../core/data/state"
import type { Store } from "../../core/store"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import { TimelineProvider, findMessage, useProjection, useTimeline, type TimelineActions, type TimelineContextValue } from "./context"
import { createTimelineInteraction, type TimelineInteraction } from "./interaction"
import { Shimmer } from "./parts/basic-tool"
import { createProjectionStore, reasoningMode, type TimelineProjection } from "./projection"
import { TimelineRowView } from "./rows"
import { ReadImageContext } from "./markdown/image-preview"
import type { ReadMarkdownImage } from "./markdown/images"
import { ScrollView } from "./scroll-view"
import { createTimelineSearch, publishSearch, type TimelineSearch } from "./search"
import { Button, Kbd } from "@buff/ui/react"
import { useCommandRegistration, useCommands } from "../../commands/provider"
import { formatKeybindParts, type KeyLabel } from "../../commands/keybind"
import { useHistory } from "../../router/router"
import { TitleLoadingContext } from "./header"
import { createMessageNavigation, messageAnchor } from "./navigation"
import type { BackgroundTask } from "./background"
import { moveToBackground, useBackground } from "./background-work"
import { ErrorPage } from "../../shell/errors/error-page"
import {
  bottomGap,
  createTimelineVirtualizer,
  fallbackItemSize,
  type Disclosure,
  type TimelineVirtualizer,
} from "./virtualizer"

export type SessionTimelineProps = {
  server: Server
  sessionID: string
  detail: TimelineDetail
  /** False while the view is kept but not shown (a cached tab); it then ignores geometry. */
  active?: boolean
  /** Center the transcript at reading width on wide screens. */
  centered?: boolean
  /** A title row inside the scroller, sticky at its top; without one the timeline starts at its first row. */
  header?: ReactNode
  actions?: TimelineActions
  /** Reads a local image of the transcript (markdown, Read results); without it they stay names. */
  readImage?: ReadMarkdownImage
  /** The screen's handle on the timeline: resume following, reveal a message. */
  onInteraction?: (interaction: TimelineInteraction | undefined) => void
  /** The session is being prepared: this status shows where work shows (see session/preparing). */
  preparing?: string
}

type Controllers = {
  projection: ReturnType<typeof createProjectionStore>
  interaction: TimelineInteraction
  search: TimelineSearch
  virtualizer: TimelineVirtualizer
}

type Source = Pick<Controllers, "projection" | "interaction"> & { search: TimelineSearch }

const anchor = messageAnchor

export function SessionTimeline(props: SessionTimelineProps) {
  const [source, setSource] = useState<Source>()
  const onInteraction = useRef(props.onInteraction)
  onInteraction.current = props.onInteraction

  // Created in a layout effect so a strict-mode remount gets fresh controllers, and the first
  // paint still has rows: the state update re-renders before the browser paints.
  // The transcript's code face loads before rich history opens, so code blocks do not reflow the
  // rows once it arrives. The shell asks for it as well, but before the window's stylesheet has
  // declared the face.
  useEffect(() => {
    const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim()
    if (mono) void document.fonts?.load(`440 13px ${mono}`).catch(() => undefined)
  }, [])

  useLayoutEffect(() => {
    const projection = createProjectionStore(props.server.data.state, props.sessionID, props.detail)
    const interaction = createTimelineInteraction({ data: props.server.data, sessionID: props.sessionID })
    const stopLoading = interaction.start()
    const search = createTimelineSearch({
      data: props.server.data.state,
      sessionID: props.sessionID,
      scroller: interaction.scroller,
      reveal: interaction.revealMessage,
      unpin: interaction.unpin,
    })
    const unpublish = publishSearch(`${props.server.key}/${props.sessionID}`, search)
    const stopPreload = preloadTail(projection.store, props.server.data.state, props.sessionID)
    setSource({ projection, interaction, search })
    onInteraction.current?.(interaction)
    return () => {
      onInteraction.current?.(undefined)
      stopPreload()
      stopLoading()
      unpublish()
      search.dispose()
      interaction.dispose()
      projection.dispose()
    }
  }, [props.server, props.sessionID, props.detail])

  return (
    <HeaderHost header={props.header} interaction={source?.interaction}>
      {source ? <ReadyTimeline {...props} source={source} /> : <PendingHeader header={props.header} />}
    </HeaderHost>
  )
}

const HeaderHostContext = createContext<HTMLElement | undefined>(undefined)

/**
 * The title row renders once per timeline, into a node of its own that moves from the loading
 * view into the scroller: remounting it there lost a rename opened while the first page loaded
 * (session-rename flaked on the React window when the heading was clicked in that window).
 */
function HeaderHost(props: { header?: ReactNode; interaction?: TimelineInteraction; children: ReactNode }) {
  const [host] = useState(() => {
    const element = document.createElement("div")
    element.style.display = "contents"
    return element
  })
  return (
    <HeaderHostContext value={host}>
      {props.header && createPortal(<HeaderLoading interaction={props.interaction}>{props.header}</HeaderLoading>, host)}
      {props.children}
    </HeaderHostContext>
  )
}

function HeaderLoading(props: { interaction?: TimelineInteraction; children: ReactNode }) {
  if (!props.interaction) return <TitleLoadingContext value>{props.children}</TitleLoadingContext>
  return <HeaderLoadingState interaction={props.interaction}>{props.children}</HeaderLoadingState>
}

function HeaderLoadingState(props: { interaction: TimelineInteraction; children: ReactNode }) {
  const ready = useStore(props.interaction.state, (state) => state.ready)
  return <TitleLoadingContext value={!ready}>{props.children}</TitleLoadingContext>
}

/** Where the title row shows: its node is attached here, not rendered here. */
function HeaderMount() {
  const host = use(HeaderHostContext)
  const mount = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = mount.current
    if (element && host && host.parentElement !== element) element.appendChild(host)
  }, [host])
  return <div ref={mount} style={{ display: "contents" }} />
}

/**
 * Start the worker job of the latest finished answer as soon as its rows are known, while the view
 * is still being built (the Solid MessageTimeline's tail preload): the cold view reveals once that
 * text is rendered, so its parse should not wait for the rows to mount.
 */
function preloadTail(
  projection: ReturnType<typeof createProjectionStore>["store"],
  data: Store<DataState>,
  sessionID: string,
) {
  const controller = new AbortController()
  const started = new Set<string>()
  const check = () => {
    const tail = projection.get().rows.at(-1)
    if (tail?._tag !== "AssistantPart" || tail.group.type !== "part") return
    const ref = tail.group.ref
    if (started.has(ref.partID)) return
    const message = findMessage(data.get(), sessionID, ref.messageID)
    if (message?.type !== "assistant" || message.time.completed === undefined) return
    const content = Timeline.resolveContent(message, ref.partID)
    if (content?.type !== "text" || !content.text.trim()) return
    started.add(ref.partID)
    void preloadMarkdown(content.text, ref.partID, controller.signal).catch(() => undefined)
  }
  check()
  const stop = projection.subscribe(check)
  return () => {
    stop()
    controller.abort()
  }
}

// The view mounts once the transcript's first page is in, as the Solid view cache waits for it:
// the virtualizer's hidden first mount must measure real rows, not an empty list.
function ReadyTimeline(props: SessionTimelineProps & { source: Source }) {
  const i18n = useI18n()
  const ready = useStore(props.source.interaction.state, (state) => state.ready)
  const search = props.source.search
  const active = props.active !== false
  // Every kept view registers Find; only the shown one offers it.
  useCommandRegistration(`session.search:${props.server.key}/${props.sessionID}`, () =>
    active
      ? [
          {
            id: "session.search",
            title: i18n.t("session.search.placeholder"),
            keybind: "mod+f",
            hidden: true,
            onSelect: search.open,
          },
        ]
      : [],
  )
  const history = useHistory()
  const [navigation, setNavigation] = useState<ReturnType<typeof createMessageNavigation>>()
  useEffect(() => {
    if (!ready) return
    const created = createMessageNavigation({
      data: props.server.data,
      sessionID: props.sessionID,
      projection: props.source.projection.store,
      interaction: props.source.interaction,
      history,
    })
    setNavigation(created)
    return created.dispose
  }, [ready, props.server, props.sessionID, props.source, history])
  useCommandRegistration(`session.messages:${props.server.key}/${props.sessionID}`, () =>
    active && navigation
      ? [
          {
            id: "message.previous",
            title: i18n.t("command.message.previous"),
            description: i18n.t("command.message.previous.description"),
            category: i18n.t("command.category.session"),
            keybind: "mod+alt+[",
            onSelect: () => navigation.step(-1),
          },
          {
            id: "message.next",
            title: i18n.t("command.message.next"),
            description: i18n.t("command.message.next.description"),
            category: i18n.t("command.category.session"),
            keybind: "mod+alt+]",
            onSelect: () => navigation.step(1),
          },
        ]
      : [],
  )
  const background = useBackground(props.server, props.sessionID)
  useCommandRegistration(`session.background:${props.server.key}/${props.sessionID}`, () =>
    active
      ? [
          {
            id: "session.background",
            title: i18n.t("command.session.background"),
            keybind: "ctrl+b",
            disabled: background.blocking.length === 0,
            onSelect: () => void moveToBackground(props.server, props.sessionID, i18n.t("common.requestFailed")),
          },
        ]
      : [],
  )
  useEffect(() => {
    if (!active) return
    document.addEventListener("opencode:timeline-search-open", search.open)
    return () => document.removeEventListener("opencode:timeline-search-open", search.open)
  }, [search, active])
  const error = useStore(props.source.interaction.state, (state) => state.error)
  // A transcript that cannot load shows the window's error page in place of the timeline.
  if (error !== undefined) return <ErrorPage error={error} />
  if (!ready) return <PendingHeader header={props.header} />
  return <VirtualizedTimeline {...props} />
}

/** The title row stays while the transcript's first page loads, as the Solid header does. */
function PendingHeader(props: { header?: ReactNode }) {
  if (!props.header) return null
  return (
    <div className="session-timeline">
      <HeaderMount />
    </div>
  )
}

function VirtualizedTimeline(props: SessionTimelineProps & { source: Source }) {
  const [virtualizer, setVirtualizer] = useState<TimelineVirtualizer>()
  const active = useRef(props.active !== false)
  active.current = props.active !== false
  const header = useRef(!!props.header)
  header.current = !!props.header
  const desktop = useMediaQuery("(min-width: 768px)")
  const isDesktop = useRef(desktop)
  isDesktop.current = desktop
  const interaction = props.source.interaction
  const projection = props.source.projection

  useLayoutEffect(() => {
    const data = props.server.data
    const created = createTimelineVirtualizer({
      sessionKey: `${props.server.key}/${props.sessionID}`,
      presentationKey: JSON.stringify(props.detail),
      projection: projection.store,
      active: () => active.current,
      showHeader: () => header.current,
      isDesktop: () => isDesktop.current,
      pinned: () => interaction.state.get().pinned,
      canRenderImmediately: (row, disclosure) =>
        renderImmediately(data.state.get(), props.sessionID, props.detail, row, disclosure),
      onPin: interaction.pin,
      onUnpin: interaction.unpin,
      onUserScroll: () => undefined,
      onHistoryScroll: interaction.onHistoryScroll,
      onScheduleScrollState: interaction.scheduleScrollState,
      setScrollRef: interaction.setScrollRef,
      setContentRef: interaction.setContentRef,
    })
    interaction.setReveal(created.revealMessage)
    interaction.setScrollToEnd(created.scrollToEnd)
    const follow = { pinned: interaction.state.get().pinned }
    // Following changes the virtualizer's anchor (end or start), as Solid's options getters do.
    const stopFollow = interaction.state.subscribe(() => {
      const pinned = interaction.state.get().pinned
      if (pinned === follow.pinned) return
      follow.pinned = pinned
      created.sync()
    })
    setVirtualizer(created)
    return () => {
      stopFollow()
      created.dispose()
    }
  }, [props.server, props.sessionID, props.detail, projection, interaction])

  useEffect(() => {
    virtualizer?.sync()
  }, [virtualizer, desktop, !!props.header])

  useEffect(() => {
    if (props.active !== false) virtualizer?.activate()
  }, [virtualizer, props.active])

  if (!virtualizer) return null
  return <TimelineView {...props} controllers={{ ...props.source, virtualizer }} />
}

function TimelineView(props: SessionTimelineProps & { controllers: Controllers }) {
  const i18n = useI18n()
  const virtualizer = props.controllers.virtualizer
  const interaction = props.controllers.interaction
  const projection = props.controllers.projection.store
  const view = useStore(virtualizer.view, (state) => state)
  const rowByKey = useStore(projection, (state) => state.rowByKey)
  const scroll = useStore(interaction.state, (state) => state.scroll)
  const context = useMemo<TimelineContextValue>(
    () => ({
      server: props.server,
      sessionID: props.sessionID,
      projection,
      disclosure: virtualizer.disclosure,
      detail: props.detail,
      centered: props.centered ?? false,
      actions: props.actions ?? {},
      anchor,
      preparing: props.preparing,
    }),
    [props.server, props.sessionID, projection, virtualizer, props.detail, props.centered, props.actions, props.preparing],
  )

  useLayoutEffect(() => virtualizer.mount(), [virtualizer])

  const topOffset = virtualizer.topOffset()
  const jump = scroll.overflow && scroll.jump
  return (
    <TimelineProvider value={context}>
      <ReadImageContext value={props.readImage}>
      <div className="session-timeline">
        <div className={`session-timeline__jump ${jump ? "session-timeline__jump--shown" : ""}`}>
          <button
            type="button"
            aria-label={i18n.t("session.messages.jumpToLatest")}
            className="session-timeline__jump-button"
            onClick={interaction.resume}
          >
            <ArrowDown aria-hidden className="size-4" />
          </button>
        </div>
        <ScrollView
          data-slot="session-timeline-scroll"
          className="session-timeline__scroll"
          viewportRef={virtualizer.bindRoot}
          onBeforeScroll={virtualizer.prepareNavigation}
          verticalScrollAdjustment={view.scrollAdjustment}
          onWheel={virtualizer.handlers.onWheel}
          onTouchStart={virtualizer.handlers.onTouchStart}
          onPointerDown={virtualizer.handlers.onPointerDown}
          onKeyDown={virtualizer.handlers.onKeyDown}
          onScroll={virtualizer.handlers.onScroll}
          onClick={interaction.selectionInteraction}
          style={{ ["--sticky-accordion-top" as string]: props.header ? "48px" : "0px" }}
        >
          {props.header ? <HeaderMount /> : <div aria-hidden="true" className="h-4 md:hidden" />}
          <div
            data-timeline-virtual-content=""
            ref={virtualizer.bindContent}
            style={{
              height: `${view.totalSize - view.scrollAdjustment}px`,
              position: "relative",
              width: "100%",
              visibility: view.cold ? "hidden" : undefined,
            }}
          >
            {view.items.map((item) => {
              const row = rowByKey.get(String(item.key))
              if (!row) return null
              return (
                <VirtualRow
                  key={String(item.key)}
                  rowKey={String(item.key)}
                  item={item}
                  row={row}
                  top={item.start - topOffset - view.scrollAdjustment}
                  virtualizer={virtualizer}
                />
              )
            })}
            <div
              data-timeline-row="bottom-spacer"
              className="absolute top-0 left-0 h-16 w-full"
              style={{ transform: `translateY(${view.totalSize - bottomGap - view.scrollAdjustment}px)` }}
            >
              <Working centered={props.centered ?? false} />
            </div>
          </div>
        </ScrollView>
      </div>
      </ReadImageContext>
    </TimelineProvider>
  )
}

const VirtualRow = memo(function VirtualRow(props: {
  rowKey: string
  item: VirtualItem
  row: TimelineRow.TimelineRow
  top: number
  virtualizer: TimelineVirtualizer
}) {
  const element = useRef<HTMLDivElement>(null)
  const initial = useRef(props.item)
  const timeline = useTimeline()
  const [ready, setReady] = useState(
    () => initial.current.size <= fallbackItemSize || !deferredRow(timeline, props.row),
  )
  const frame = useRef<number | undefined>(undefined)
  const index = useRef(props.item.index)
  index.current = props.item.index
  const virtualizer = props.virtualizer

  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    virtualizer.measureRow(node)
    virtualizer.pinAddedUserMessage(props.rowKey, () => index.current, node)
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
      // Prepending history changes data-index, not the keyed element's identity.
      queueMicrotask(() => virtualizer.measureRow(null))
    }
  }, [virtualizer, props.rowKey])

  const onSizeChange = useCallback(() => {
    setReady(true)
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      if (element.current) virtualizer.remeasure(element.current)
    })
  }, [virtualizer])

  return (
    <div
      data-timeline-key={props.rowKey}
      style={{
        position: "absolute",
        top: `${props.top}px`,
        left: 0,
        width: "100%",
        height: `${props.item.size}px`,
        overflow: "clip",
        overflowClipMargin: props.row._tag === "TurnGap" ? undefined : "0.5px",
      }}
    >
      <div
        ref={element}
        data-index={props.item.index}
        style={{ minHeight: ready ? undefined : `${initial.current.size}px` }}
      >
        <TimelineRowView row={props.row} onSizeChange={onSizeChange} />
      </div>
    </div>
  )
})

// Edit and write calls mount their diffs late; a measured row keeps its height meanwhile.
function deferredRow(timeline: TimelineContextValue, row: TimelineRow.TimelineRow) {
  if (row._tag !== "AssistantPart" || row.group.type !== "part") return false
  const state = timeline.server.data.state.get()
  const content = Timeline.resolveContent(findMessage(state, timeline.sessionID, row.group.ref.messageID), row.group.ref.partID)
  return content?.type === "tool" && ["edit", "write"].includes(content.name)
}

/** "Working" under the latest turn while it runs without visible progress of its own. */
function Working(props: { centered: boolean }) {
  const i18n = useI18n()
  const timeline = useTimeline()
  const commands = useCommands()
  const background = useBackground(timeline.server, timeline.sessionID)
  const shown = useStore(timeline.server.data.state, (state) =>
    showWorking(state, timeline.sessionID, timeline.projection.get(), background.tasks),
  )
  const blocking = new Set(background.blocking.map((item) => item.partID))
  const hint = useProjection(
    (projection) =>
      blocking.size > 0 &&
      projection.rows.some(
        (row) =>
          row._tag === "AssistantPart" &&
          (row.group.type === "part" ? [row.group.ref] : row.group.refs).some((ref) => blocking.has(ref.partID)),
      ),
  )
  if (timeline.preparing)
    return (
      <div className={`timeline-row ${props.centered ? "timeline-row--centered" : ""}`}>
        <div className="timeline-working timeline-inset">
          <div data-component="session-preparing-status" role="status">
            <Shimmer text={timeline.preparing} active />
          </div>
        </div>
      </div>
    )
  if (!shown && !hint) return null
  const keybind = commands.keybind("session.background") ?? "ctrl+b"
  const parts = formatKeybindParts(keybind, (key: KeyLabel) => i18n.t(key))
  return (
    <div className={`timeline-row ${props.centered ? "timeline-row--centered" : ""}`}>
      <div className="timeline-working timeline-inset">
        {shown && (
          <div data-component="session-working" role="status">
            <Shimmer text={i18n.t("session.timeline.working")} active />
          </div>
        )}
        {hint && (
          <div data-component="session-background-hint-row" className="timeline-background-hint">
            <Button
              data-component="session-background-hint"
              type="button"
              variant="ghost"
              size="sm"
              aria-label={i18n.t("session.background.moveInline", { keybind: parts.join("+") })}
              onClick={() =>
                void moveToBackground(timeline.server, timeline.sessionID, i18n.t("common.requestFailed"))
              }
            >
              <span className="min-w-0 truncate">{i18n.t("session.background.moveRunning")}</span>
              {parts.map((part) => (
                <Kbd key={part}>{part}</Kbd>
              ))}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function showWorking(state: DataState, sessionID: string, projection: TimelineProjection, background: BackgroundTask[]) {
  const backgrounded = new Set(background.map((task) => task.id))
  if (state.session.active[sessionID] !== "running") return false
  if (state.session.permission[sessionID]?.length || state.session.form[sessionID]?.length) return false
  const active = projection.activeMessageID
  if (!active) return false
  const id = projection.assistantMessagesByParent.get(active)?.at(-1)?.id
  const found = id ? findMessage(state, sessionID, id) : undefined
  const assistant = found?.type === "assistant" ? found : undefined
  if (assistant?.retry) return false
  // Pending steers still project under the previous response until delivery. Its error must not
  // hide feedback for a newly submitted prompt.
  const steering = (state.session.pending[sessionID] ?? []).some(
    (item) => item.type === "user" && item.delivery === "steer",
  )
  if (assistant?.error && !steering) return false
  const content = assistant?.content.at(-1)
  if (
    assistant?.time.completed === undefined &&
    assistant?.time.streamed === undefined &&
    content?.type === "text" &&
    content.text.trim()
  )
    return false
  return !projection.rows.some((row) => {
    if (row.userMessageID !== active) return false
    if (row._tag === "Thinking") return true
    if (row._tag === "Notice") {
      const message = findMessage(state, sessionID, row.messageID)
      return message?.type === "compaction" && message.status === "running"
    }
    // Used groups keep the fallback regardless of disclosure state.
    if (row._tag !== "AssistantPart" || row.group.type === "context") return false
    return (row.group.type === "part" ? [row.group.ref] : row.group.refs).some((ref) => {
      const content = Timeline.resolveContent(findMessage(state, sessionID, ref.messageID), ref.partID)
      if (content?.type !== "tool") return false
      if (content.state.status === "streaming" || content.state.status === "running") return true
      const metadata = "metadata" in content.state ? content.state.metadata : undefined
      const taskID = metadata?.[content.name === "subagent" ? "sessionID" : "shellID"]
      return backgrounded.has(content.id) || (typeof taskID === "string" && backgrounded.has(taskID))
    })
  })
}

// Rows cheap enough to mount in the first batch of a cold, pinned view.
function renderImmediately(
  state: DataState,
  sessionID: string,
  detail: TimelineDetail,
  row: TimelineRow.TimelineRow,
  disclosure: Disclosure,
) {
  if (row._tag === "TurnGap" || row._tag === "TurnDivider") return true
  if (row._tag === "Notice") {
    const message = findMessage(state, sessionID, row.messageID)
    return (
      (message?.type === "system" || message?.type === "synthetic") &&
      (message.description ?? message.text).length <= 1024
    )
  }
  if (row._tag === "UserMessage") {
    const message = findMessage(state, sessionID, row.userMessageID)
    if (message?.type !== "user" || message.text.length > 1024 || message.files?.length || message.agents?.length)
      return false
    const presentation = readPromptPresentation(message.metadata)
    return (
      (presentation?.displayText ?? message.text).length <= 1024 &&
      !presentation?.comments?.length &&
      !presentation?.attachments.length &&
      !parseCommentNote(message.text)
    )
  }
  if (row._tag !== "AssistantPart" || row.group.type !== "part") return false
  const message = findMessage(state, sessionID, row.group.ref.messageID)
  if (message?.type !== "assistant" || message.time.completed === undefined) return false
  const content = Timeline.resolveContent(message, row.group.ref.partID)
  if (content?.type === "reasoning") return !(disclosure[row.group.ref.partID] ?? reasoningMode(detail) === "full")
  return (
    content?.type === "text" &&
    content.text.length <= 1024 &&
    !!getReadyMarkdown({ raw: content.text, src: content.text }, `${row.group.ref.partID}:0:full`)
  )
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    media.addEventListener("change", update)
    update()
    return () => media.removeEventListener("change", update)
  }, [query])
  return matches
}
