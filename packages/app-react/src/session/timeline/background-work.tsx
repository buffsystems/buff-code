// Background work on screen (#584): the session details' row and list of it, Buff's running time,
// «Output» and «Halt» per item (#456), and the move of a turn's running work to the background.

import { Button, Dialog, Popover, PopoverContent, PopoverTrigger } from "@buff/ui/react"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffBackground } from "@opencode/schema/buff-background"
import { ArrowUpRight } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import { useStore } from "../../react/use-store"
import { showToast } from "../../shell/notifications/toast"
import { createStore } from "../../core/store"
import { sessionHref } from "../../router/routes"
import { useNavigateToSession } from "../navigate"
import { useSession } from "../context"
import { createBackgroundSelector, type BackgroundTask } from "./background"
import { Shimmer } from "./parts/basic-tool"

/** The session's background work, recomputed only when its inputs change. */
export function useBackground(server: Server, sessionID: string) {
  const select = useMemo(() => createBackgroundSelector(sessionID), [sessionID])
  return useServerData(server, select)
}

/** Ask the server to move the running turn's shells and subagents to the background. */
export function moveToBackground(server: Server, sessionID: string, failed: string) {
  return server
    .api()
    .session.background({ sessionID })
    .catch((error: unknown) =>
      showToast({ variant: "error", title: failed, description: error instanceof Error ? error.message : String(error) }),
    )
}

// One clock for every running-time label on screen.
const clock = createStore(Date.now())
const ticking = { watchers: 0, timer: undefined as ReturnType<typeof setInterval> | undefined }
function useNow() {
  useEffect(() => {
    ticking.watchers += 1
    ticking.timer ??= setInterval(() => clock.set(() => Date.now()), 1_000)
    clock.set(() => Date.now())
    return () => {
      ticking.watchers -= 1
      if (ticking.watchers > 0 || !ticking.timer) return
      clearInterval(ticking.timer)
      ticking.timer = undefined
    }
  }, [])
  return useStore(clock, (now) => now)
}

function useStop(server: Server, directory: string) {
  const i18n = useI18n()
  return (item: BackgroundTask) =>
    server
      .api()
      .rpc(BuffBackground.Rpc)
      .stop({ id: item.id }, { location: { directory } })
      .then(
        (result) => {
          if (!result.stopped) showToast({ title: item.label, description: i18n.buff.t("Already finished.") })
        },
        (error: unknown) =>
          showToast({
            variant: "error",
            title: item.label,
            description: formatServerError(error, undefined, i18n.buff.t("Could not stop.")),
          }),
      )
}

/** Everything a background command wrote, followed while it runs. */
function OutputDialog(props: { server: Server; directory: string; item: BackgroundTask; onClose: () => void }) {
  const i18n = useI18n()
  const now = useNow()
  const stop = useStop(props.server, props.directory)
  const [text, setText] = useState("")
  const [gone, setGone] = useState(false)
  const view = useRef<HTMLPreElement>(null)
  const running = useServerData(props.server, (state) =>
    Object.values(state.location).some((location) => location.shell?.[props.item.id]?.status === "running"),
  )
  const live = useRef(running)
  live.current = running
  useEffect(() => {
    const state = { cursor: 0, busy: false, stopped: false }
    const read = async () => {
      if (state.busy) return
      state.busy = true
      const output = await readAll(props.server, props.directory, props.item.id, state.cursor).catch(() => undefined)
      state.busy = false
      if (state.stopped) return
      if (!output) return setGone(true)
      state.cursor = output.cursor
      if (!output.text) return
      const element = view.current
      const pinned = !element || element.scrollTop + element.clientHeight >= element.scrollHeight - 8
      setText((value) => value + output.text)
      if (pinned) queueMicrotask(() => element?.scrollTo({ top: element.scrollHeight }))
    }
    void read()
    const timer = setInterval(() => void (live.current ? read() : undefined), 1_000)
    return () => {
      state.stopped = true
      clearInterval(timer)
    }
  }, [props.server, props.directory, props.item.id])
  const t = i18n.buff.t
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()} title={t("Command output")} size="lg" closeLabel={i18n.t("ui.common.close")}>
      <div className="background-output" data-component="buff-background-output">
        <div className="background-output__head">
          <code className="background-output__command">{props.item.label}</code>
          <span className="background-time">
            {running ? (BuffBackground.since(props.item.started, now, t) ?? t("running")) : t("finished")}
          </span>
          {running && (
            <Button size="sm" variant="outline" data-action="buff-background-stop" onClick={() => void stop(props.item)}>
              {t("Halt")}
            </Button>
          )}
        </div>
        <pre ref={view} className="background-output__text" data-slot="output">
          {text || (gone ? t("The output is no longer available.") : t("Nothing written yet."))}
        </pre>
      </div>
    </Dialog>
  )
}

// A background command's output, page by page until it catches up with what is written.
async function readAll(server: Server, directory: string, id: string, from: number) {
  const pages = async (cursor: number, text: string): Promise<{ text: string; cursor: number }> => {
    const page = (await server.api().shell.output({ id, location: { directory }, cursor })).data
    if (page.cursor <= cursor) return { text, cursor }
    const next = text + page.output
    if (page.cursor >= page.size) return { text: next, cursor: page.cursor }
    return pages(page.cursor, next)
  }
  return pages(from, "")
}

/** Buff (#456): running time, «Output» for a command and «Halt», on one background row. */
function BackgroundControls(props: { server: Server; directory: string; item: BackgroundTask; onOpen: () => void }) {
  const i18n = useI18n()
  const dialog = useDialog()
  const now = useNow()
  const stop = useStop(props.server, props.directory)
  const [stopping, setStopping] = useState(false)
  const t = i18n.buff.t
  // A subagent's row is a link to its session: the buttons keep their clicks.
  const press = (event: MouseEvent, action: () => void) => {
    event.preventDefault()
    event.stopPropagation()
    action()
  }
  const since = BuffBackground.since(props.item.started, now, t)
  return (
    <span className="background-controls" data-component="buff-background-controls">
      {since && <span className="background-time">{since}</span>}
      {props.item.type === "shell" && (
        <button
          type="button"
          className="background-action"
          data-action="buff-background-output"
          onClick={(event) =>
            press(event, () => {
              props.onOpen()
              dialog.show((close) => (
                <OutputDialog server={props.server} directory={props.directory} item={props.item} onClose={close} />
              ))
            })
          }
        >
          {t("Output")}
        </button>
      )}
      <button
        type="button"
        className="background-action"
        data-action="buff-background-stop"
        disabled={stopping}
        onClick={(event) =>
          press(event, () => {
            setStopping(true)
            void stop(props.item).finally(() => setStopping(false))
          })
        }
      >
        {t("Halt")}
      </button>
    </span>
  )
}

/** "N background tasks running", opening the list of them with their controls. */
export function BackgroundWorkSummary(props: {
  server: Server
  sessionID: string
  sessionHref?: (sessionID: string) => string
  navigateToSession?: (sessionID: string) => void
  compact?: boolean
}) {
  const i18n = useI18n()
  const tasks = useBackground(props.server, props.sessionID).tasks
  const directory = useServerData(props.server, (state) => state.session.info[props.sessionID]?.location.directory) ?? ""
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (tasks.length === 0) setOpen(false)
  }, [tasks.length])
  if (tasks.length === 0) return null
  const label = i18n.plural("session.background.tasksRunning", tasks.length)
  const type = (task: BackgroundTask) => {
    if (task.type === "shell") return i18n.t("ui.tool.shell")
    if (!task.agent) return i18n.t("ui.tool.agent.default")
    return task.agent.slice(0, 1).toUpperCase() + task.agent.slice(1)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-component="session-background-summary"
          // In «Session details» it is one of the summary card's rows (summary/summary.css).
          className={props.compact ? "summary-row summary-row--chip" : "session-summary-row"}
          aria-label={label}
        >
          <ArrowUpRight aria-hidden className="summary-row__icon" />
          <Shimmer text={label} className={props.compact ? "summary-row__label" : "session-summary-label"} />
        </button>
      </PopoverTrigger>
      <PopoverContent side={props.compact ? "top" : "left"} align="end" data-component="session-background-list" aria-label={label} className="background-list">
        {tasks.map((task) => {
          const href = task.type === "subagent" ? props.sessionHref?.(task.id) : undefined
          const content = (
            <>
              <span className="shrink-0">{type(task)}</span>
              <span className="summary-row__label timeline-faint">{task.label}</span>
              <BackgroundControls server={props.server} directory={directory} item={task} onOpen={() => setOpen(false)} />
            </>
          )
          if (!href)
            return (
              <div key={task.id} data-component="session-background-list-item" className="background-list__item">
                {content}
              </div>
            )
          return (
            <a
              key={task.id}
              href={href}
              data-component="session-background-list-item"
              className="background-list__item background-list__item--link"
              onClick={(event) => {
                if (!props.navigateToSession) return
                if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
                event.preventDefault()
                setOpen(false)
                props.navigateToSession(task.id)
              }}
            >
              {content}
            </a>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

/** The background-work chip under the composer: the same summary, compact. */
export function BackgroundChip() {
  const session = useSession()
  const navigateToSession = useNavigateToSession(session.server, session.sessionID)
  return (
    <span className="background-chip">
      <BackgroundWorkSummary
        server={session.server}
        sessionID={session.sessionID}
        compact
        sessionHref={(id) => sessionHref(session.server.key, id)}
        navigateToSession={(id) => void navigateToSession(id)}
      />
    </span>
  )
}
