// The simple layout's transcript (#972): a chat drawn as the web client draws it — a turn in one
// line that opens its steps in words, the answer, what a stopped or failed turn offers — by the
// same components (`TranscriptRows`, `TurnView` of @buff/ui) and the same fold (`foldChat`).
// The developer layout keeps the window's own timeline with its presets; this one is for a
// person who came to talk to the agent, not to read its tool calls.

import {
  Button,
  ChatHostProvider,
  ChatLayout,
  ScrollToEnd,
  TranscriptSkeleton,
  UserMessage,
  TranscriptRows,
  useTranscriptFollow,
  type ChatHost,
  type TurnActions,
} from "@buff/ui/react"
import { chatWords, foldChat, type FileLinks, type Turn } from "@buff/ui/chat-logic"
import { visibleTimelineMessages } from "@opencode/app/react-reuse/timeline-projection"
import type { SessionTurnFailure } from "@opencode/session-ui/actions"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import { useCommandRegistration } from "../../commands/provider"
import { useRequestsBlocked } from "../docks/requests"
import { moveToBackground, useBackground } from "../timeline/background-work"
import { publishSearch } from "../timeline/search"
import { createSimpleSearch } from "./search"
import { nearestBox } from "../focus-box"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { failureOf, isRequest, modelNames, replaceable, requestText, tail, toChat } from "./chat"

const none: never[] = []
const nothing: SessionMessageInfo[] = []

export type SimpleTranscriptProps = {
  server: Server
  sessionID: string
  /** The title row over the transcript, as the timeline has it. */
  header?: ReactNode
  /** Asks the last request again in place of its answer. Absent in a helper's chat: it is only read. */
  retry?: (userMessageID: string) => void
  /** False where asking again is no use — the limit is used up and only a top-up helps. */
  retryHelps?: (failure: SessionTurnFailure) => boolean
  /** Back to before the turn's request, with it in the box (the window asks first). */
  rewind?: (userMessageID: string) => void
  /** The window's card for a failed turn: the reason, and what mends it. */
  failureCard?: (failure: SessionTurnFailure) => ReactNode
  /** Under a finished turn's answer: the files it changed, with their rewind. */
  summary?: (input: { userMessageID: string }) => ReactNode
  /** Opens a file of the chat beside it. */
  openFile?: (path: string) => void
  /** A file's bytes: pictures the agent handed over show themselves. */
  readFile?: (path: string) => Promise<Blob>
  /** Whether this view is the one shown: session views stay mounted, detached, when another is. */
  active: boolean
}

export function SimpleTranscript(props: SimpleTranscriptProps) {
  const i18n = useI18n()
  const locale = i18n.locale === "ru" ? "ru" : "en"
  const { server, sessionID } = props
  const stored = useServerData(server, (state) => state.session.message[sessionID] ?? none)
  const read = useServerData(server, (state) => state.session.message[sessionID] !== undefined)
  // A question or a permission waits for the person: the turn's clock stands meanwhile.
  const waiting = useRequestsBlocked()
  const pending = useServerData(server, (state) => state.session.pending[sessionID] ?? none)
  const revert = useServerData(server, (state) => state.session.info[sessionID]?.revert?.messageID)
  const running = useServerData(server, (state) => state.session.active[sessionID] === "running")
  const names = useServerData(server, (state) => modelNames(state, sessionID), sameNames)
  const cursor = useServerData(server, (state) => state.session.messageCursor[sessionID])
  const earlier = cursor !== undefined
  const loading = useServerData(server, (state) => state.session.messageLoading[sessionID] ?? false)
  // What waits in the queue is kept out of the transcript; the route reads the messages.
  useEffect(() => {
    void server.data.session.pending.sync(sessionID).catch(() => undefined)
  }, [server, sessionID])

  // Everything the person sees of the chat: what waits in the queue is out, a rewind's tail too.
  const visible = useMemo(() => visibleTimelineMessages(stored, pending, revert), [stored, pending, revert])
  // A message sent into a turn at work reaches the agent at its next step. Until then it is the
  // person's, not a turn: folded in, it would close the turn still working. It is drawn under
  // the transcript as «on its way». Sent to a chat at rest, it is simply the next request.
  const onWay = useMemo(() => {
    if (!running) return nothing
    const steers = new Set(
      pending.flatMap((item) => (item.type === "user" && item.delivery === "steer" ? [item.id] : [])),
    )
    return steers.size ? visible.filter((message) => steers.has(message.id)) : nothing
  }, [visible, pending, running])
  const messages = useMemo(
    () => (onWay.length ? visible.filter((message) => !onWay.includes(message)) : visible),
    [visible, onWay],
  )
  // A command of the person's shell runs without the agent: the chat is at work while it runs.
  const newest = messages.at(-1)
  const shelling = newest?.type === "shell" && newest.status === "running"
  const rows = useMemo(
    () => foldChat(toChat(messages, running), { running: running || shelling, waiting }),
    [messages, running, shelling, waiting],
  )

  // The running turn's clock.
  const [now, setNow] = useState(() => Date.now())
  // Bumped when a view put back into the page has got its size.
  const [sized, setSized] = useState(0)
  const ticking = running || shelling
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])

  const scroll = useTranscriptFollow()
  // The person's own new request is a send: the view goes to it and follows the answer's start.
  // Theirs — sent from this window's box, which still holds focus; a queued message delivered
  // later or one from the phone does not pull a reader out of the history. Ids grow with time,
  // so an earlier page read in is not a new request either.
  const request = newestRequest(visible)
  const seen = useRef(request)
  const { act, onOwnChange } = scroll
  useEffect(() => {
    const before = seen.current
    seen.current = request
    if (!request || !before || request <= before) return
    const box = nearestBox(scroll.scroller.current)
    if (box && (box === document.activeElement || box.contains(document.activeElement))) act({ type: "sent" })
  }, [request, act, scroll.scroller])

  // An earlier page comes in above what the person reads: the view keeps its place.
  const first = messages[0]?.id
  const held = useRef<{ first: string | undefined; fromEnd: number } | null>(null)
  const loadEarlier = () => {
    const el = scroll.scroller.current
    held.current = el ? { first, fromEnd: el.scrollHeight - el.scrollTop } : null
    void server.data.session.message.loadMore(sessionID).catch(() => undefined)
  }
  // Earlier pages are read without asking in two cases: the first page starts inside a turn
  // (its request is on the page before — without it the turn has no «Повторить»), and the chat is
  // shorter than the window. Only in the view that is shown: a detached one measures as empty
  // and would read the whole history.
  const { active } = props
  // «Inside a turn» means no request on the page at all: one long turn can fill a page, but the
  // pages are not read on until a page happens to start with a request. A page that failed to
  // come is not asked for again by itself — the button stays.
  const headless = messages.length > 0 && !messages.some((message) => message.type === "user")
  const asked = useRef<string | undefined>(undefined)
  useEffect(() => {
    const el = scroll.scroller.current
    if (!active || !el || el.clientHeight === 0 || !cursor || loading || messages.length === 0) return
    if (!headless && el.scrollHeight > el.clientHeight + 1) return
    if (asked.current === cursor) return
    asked.current = cursor
    held.current = { first, fromEnd: el.scrollHeight - el.scrollTop }
    void server.data.session.message.loadMore(sessionID).catch(() => undefined)
  }, [active, sized, cursor, loading, headless, first, messages.length, server, sessionID, scroll.scroller])

  // A view set aside comes back scrolled to its top: it is put back where the person left it.
  // Whether it was following the end is the follow rule's to say, not the last scroll's: an
  // answer that outgrew the window parks the view at its start without any scroll.
  const place = useRef(0)
  const followed = useRef(scroll.view.following)
  followed.current = scroll.view.following
  const left = useRef<{ top: number; following: boolean; tail: string } | null>(null)
  const shownOnce = useRef(false)
  const onScroll = () => {
    const el = scroll.scroller.current
    if (el && el.clientHeight > 0) place.current = el.scrollTop
    scroll.onScroll()
  }
  // The layout reports a size change as growth. A view put back into the page, or an earlier
  // page read in above, changes the size too — and is no news below: such a report is not passed.
  const quiet = useRef(0)
  const hush = () => (quiet.current = performance.now() + 400)
  const onGrow = (fits: boolean) => {
    if (performance.now() >= quiet.current) scroll.onGrow(fits)
  }
  useEffect(() => {
    if (!active) return
    // A view shown for the first time has no place to come back to: its growth is real.
    if (left.current) hush()
    // The view is put back into the page after it is told it is shown: wait until it has a size.
    const waited = { frames: 0, frame: 0 }
    const back = () => {
      const el = scroll.scroller.current
      if (!el || el.clientHeight === 0) {
        if (waited.frames++ < 30) waited.frame = requestAnimationFrame(back)
        return
      }
      // The view has its size now: what waited for one (a short chat's earlier pages) can go on.
      setSized((n) => n + 1)
      shownOnce.current = true
      const was = left.current
      if (!was) return
      hush()
      if (!was.following) {
        // Left inside the chat (or at the start of a long answer): put back there, and it stays.
        el.scrollTop = was.top
        act({ type: "placed" })
        // What the agent wrote meanwhile is news below: said once, as growth.
        if (tail(messagesNow.current) !== was.tail) scroll.onGrow(false)
        return
      }
      // Left following the end: on from the end — a frame later, when the layout has measured
      // the last turn's room again (it is part of how far the end is).
      waited.frame = requestAnimationFrame(() => {
        hush()
        el.scrollTop = el.scrollHeight
        onOwnChange(0)
      })
    }
    back()
    return () => {
      cancelAnimationFrame(waited.frame)
      // Set aside now: remember how it was left, before a detached view's events blur it. A view
      // that never got a size was not shown (a development double mount): nothing to remember.
      if (shownOnce.current)
        left.current = {
          top: place.current,
          following: followed.current,
          // By what the chat holds, not by pixels: the view is already out of the page here.
          tail: tail(messagesNow.current),
        }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, scroll.scroller, act, onOwnChange])
  useLayoutEffect(() => {
    const el = scroll.scroller.current
    const was = held.current
    if (!el || !was || was.first === first) return
    held.current = null
    hush()
    el.scrollTop = el.scrollHeight - was.fromEnd
    onOwnChange(el.scrollHeight - el.scrollTop - el.clientHeight)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, scroll.scroller, onOwnChange])

  // Find in the chat (mod+F), from one request to the next, a blocking helper sent to the
  // background: the commands the timeline registers, here over the simple transcript. Every kept
  // view has them; only the shown one offers them.
  const shown = useRef(active)
  shown.current = active
  const search = useMemo(
    () => createSimpleSearch({ scroller: () => scroll.scroller.current, shown: () => shown.current }),
    [scroll.scroller],
  )
  useEffect(() => {
    const unpublish = publishSearch(`${server.key}/${sessionID}`, search)
    return () => {
      unpublish()
      search.dispose()
    }
  }, [server.key, sessionID, search])
  useEffect(() => {
    if (!active) return
    search.resume()
    document.addEventListener("opencode:timeline-search-open", search.open)
    // The highlights are the page's, not the view's: a view set aside gives them up — in the
    // cleanup, which runs before the view now shown paints its own.
    return () => {
      document.removeEventListener("opencode:timeline-search-open", search.open)
      search.rest()
    }
  }, [search, active])
  const step = (delta: 1 | -1) => {
    const el = scroll.scroller.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    const turns = [...el.querySelectorAll<HTMLElement>(".ui-turn")]
    const offsets = turns.map((turn) => turn.getBoundingClientRect().top - top)
    const target = delta > 0 ? turns[offsets.findIndex((at) => at > 8)] : turns[offsets.findLastIndex((at) => at < -8)]
    target?.scrollIntoView({ block: "start" })
  }
  const background = useBackground(server, sessionID)
  const blocking = background.blocking.length
  useCommandRegistration(`simple.session:${server.key}/${sessionID}`, () =>
    active
      ? [
          {
            id: "session.search",
            title: i18n.t("session.search.placeholder"),
            keybind: "mod+f",
            hidden: true,
            onSelect: search.open,
          },
          {
            id: "message.previous",
            title: i18n.t("command.message.previous"),
            description: i18n.t("command.message.previous.description"),
            category: i18n.t("command.category.session"),
            keybind: "mod+alt+[",
            onSelect: () => step(-1),
          },
          {
            id: "message.next",
            title: i18n.t("command.message.next"),
            description: i18n.t("command.message.next.description"),
            category: i18n.t("command.category.session"),
            keybind: "mod+alt+]",
            onSelect: () => step(1),
          },
          {
            id: "session.background",
            title: i18n.t("command.session.background"),
            keybind: "ctrl+b",
            disabled: blocking === 0,
            onSelect: () => void moveToBackground(server, sessionID, i18n.t("common.requestFailed")),
          },
        ]
      : [],
  )

  const host = useMemo<ChatHost>(
    () => ({
      t: chatWords(locale),
      locale,
      ...(props.readFile ? { readFile: props.readFile } : {}),
      modelName: (model) => (model ? (names.get(model) ?? model) : undefined),
    }),
    [locale, props.readFile, names],
  )
  const messagesNow = useRef(messages)
  messagesNow.current = messages
  const { retry, rewind, failureCard, openFile, summary } = props
  // A rewind already staged («Вернуть») is settled first: asking again over it would move files.
  const staged = useRef(!!revert)
  staged.current = !!revert
  const helps = useRef(props.retryHelps)
  helps.current = props.retryHelps
  const retryHelps = (turn: Turn) => {
    const failure = helps.current ? failureOf(turn, messagesNow.current) : undefined
    return failure && helps.current ? helps.current(failure) : true
  }
  const actions = useMemo<TurnActions>(
    () => ({
      ...(retry ? { retry: (turn: Turn) => turn.user && retry(turn.user.id) } : {}),
      ...(rewind ? { edit: (turn: Turn) => turn.user && rewind(turn.user.id) } : {}),
      // Asked again is the last request only — an older one would take the later turns with it;
      // a command of the person's shell is neither asked again nor changed.
      canRetry: (turn: Turn) =>
        // Asking again takes what followed the request with it: the last request only.
        !!turn.user && replaceable(messagesNow.current, staged.current, turn.user.id) && retryHelps(turn),
      canEdit: (turn: Turn) => !!turn.user && isRequest(messagesNow.current, turn.user.id),
      ...(failureCard
        ? {
            failure: (turn: Turn) => {
              const failure = failureOf(turn, messagesNow.current)
              return failure ? failureCard(failure) : undefined
            },
          }
        : {}),
      ...(summary ? { after: (turn: Turn) => turn.user && summary({ userMessageID: turn.user.id }) } : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [retry, rewind, failureCard, summary],
  )
  // What an earlier part of the chat was folded into is in the fold's own message.
  const summaryOf = useMemo(
    () => async (id: string) => {
      const message = messagesNow.current.find((item) => item.id === id)
      return message?.type === "compaction" && "summary" in message ? message.summary : ""
    },
    [],
  )
  const links = useMemo<FileLinks | null>(
    () =>
      openFile
        ? {
            // No address: a file opens beside the chat, there is no page of its own to link to.
            href: () => null,
            open: openFile,
            textHref: () => null,
            textOpen: () => undefined,
          }
        : null,
    [openFile],
  )

  return (
    <ChatHostProvider host={host}>
      <ChatLayout
        // The view's slot is a plain block: the layout takes its height, so the chat scrolls inside.
        className="h-full"
        label={host.t("chat.transcript")}
        header={props.header}
        dock={null}
        scrollRef={scroll.scroller}
        onScroll={onScroll}
        onGrow={onGrow}
        onOwnChange={scroll.onOwnChange}
        floating={
          <ScrollToEnd
            visible={scroll.view.away}
            fresh={scroll.view.fresh}
            label={host.t("chat.toEnd")}
            onClick={() => scroll.act({ type: "toEnd" })}
          />
        }
      >
        {rows.length === 0 && (loading || !read) && <TranscriptSkeleton label={host.t("chat.loading")} />}
        {earlier && rows.length > 0 && (
          <Button variant="ghost" size="sm" className="self-center" loading={loading} onClick={loadEarlier}>
            {host.t("chat.earlier")}
          </Button>
        )}
        <TranscriptRows
          rows={rows}
          density="normal"
          now={now}
          busy={running}
          actions={actions}
          links={links}
          summaryOf={summaryOf}
        />
        {onWay.map((message) =>
          message.type === "user" ? (
            <UserMessage
              key={message.id}
              text={requestText(message)}
              marked={i18n.buff.t("On its way — the agent gets it at its next step")}
            />
          ) : null,
        )}
      </ChatLayout>
    </ChatHostProvider>
  )
}

function newestRequest(messages: readonly { type: string; id: string }[]): string | undefined {
  return messages.findLast((message) => message.type === "user")?.id
}

function sameNames(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>) {
  if (a.size !== b.size) return false
  for (const [id, name] of a) if (b.get(id) !== name) return false
  return true
}
