// Home's session list (#584): the search, the recent sessions by day, and each row's menu —
// rename in place, export, delete. Ported from the Solid Home's sessions view.

import { BuffFeatures } from "@opencode/schema/buff-features"
import {
  Button,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  InlineInput,
  Panel,
  Spinner,
} from "@buff/ui/react"
import { shouldOpenSessionInBackground } from "@opencode/app/react-reuse/home-open"
import { sessionLabel } from "@opencode/app/react-reuse/session-title"
import type { SessionInfo } from "@opencode/client/promise"
import { Search, SquarePen, X } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { isMac } from "../commands/keybind"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { useServerData } from "../react/core"
import { ContextMenu } from "../shell/menu/context-menu"
import { ProjectAvatar, SessionProgress } from "../shell/project-avatar"
import { sessionActivity } from "../shell/tabs/activity"
import { shallowEqual } from "../react/use-store"
import { homeSearchKey, type HomeSessionGroup, type HomeSessionRecord } from "./model"
import type { HomeSearch } from "./search"

export type OpenOptions = { background?: boolean }

export type HomeSessionActions = {
  open: (session: SessionInfo, options?: OpenOptions) => void
  rename: (session: SessionInfo, title: string) => Promise<boolean>
  export: (session: SessionInfo) => Promise<void>
  remove: (session: SessionInfo) => void
  create?: () => void
  isOpen: (session: SessionInfo) => boolean
}

const SEARCH_RESULTS_ID = "home-session-search-results"

// Middle click, or Cmd+click on macOS (Ctrl+click elsewhere), opens a tab without leaving Home.
const background = (event: MouseEvent) =>
  shouldOpenSessionInBackground({
    button: event.button,
    mac: isMac(),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })

export function HomeSessions(props: {
  server: Server
  groups: HomeSessionGroup[]
  loading: boolean
  showProjectName: boolean
  search: HomeSearch
  actions: HomeSessionActions
}) {
  const i18n = useI18n()
  return (
    <section aria-label={i18n.t("sidebar.project.recentSessions")} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="sticky top-0 z-30 shrink-0 bg-background pb-1 pt-6 md:pb-3 lg:pt-12">
        <HomeSessionSearch {...props} />
        {props.groups.length > 0 && props.actions.create && (
          <div className="flex justify-end pt-2">
            <Button data-action="home-new-session" variant="ghost" size="sm" onClick={props.actions.create}>
              <SquarePen aria-hidden className="size-4" />
              {i18n.t("command.session.new")}
            </Button>
          </div>
        )}
      </div>
      {props.loading ? (
        <div className="flex min-w-0 flex-col gap-4 pt-1 md:pt-3">
          <div className="ui-eyebrow px-1.5 md:px-3">{i18n.t("common.loading")}</div>
          <div className="flex min-w-0 flex-col gap-px" aria-hidden="true">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-10 rounded-md bg-muted opacity-70" />
            ))}
          </div>
        </div>
      ) : props.groups.length === 0 ? (
        <HomeSessionsEmpty onCreate={props.actions.create} />
      ) : (
        <div className="flex flex-col pb-16 pt-1 md:pt-3">
          {props.groups.map((group, index) => (
            <div key={group.id} className={index === props.groups.length - 1 ? "" : "mb-6"}>
              <div className="sticky top-0 z-10 flex h-7 min-w-0 items-center bg-background ps-1.5 md:ps-3">
                <h2 className="text-[14px] font-semibold">{group.title}</h2>
              </div>
              <div className="flex min-w-0 flex-col gap-px pt-2 md:pt-4">
                {group.sessions.map((record) => (
                  <HomeSessionRow
                    key={record.session.id}
                    record={record}
                    server={props.server}
                    showProjectName={props.showProjectName}
                    actions={props.actions}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function HomeSessionsEmpty(props: { onCreate?: () => void }) {
  const i18n = useI18n()
  return (
    // The rest of the column under the sticky search, not its full height: 100% overflowed the page by
    // the search's height and showed a scrollbar on an empty Home.
    <div className="flex flex-1 flex-col items-center gap-4 px-6 pt-[52px] text-center">
      <div className="text-[13px] font-medium">{i18n.t("home.sessions.empty")}</div>
      <p className="ui-note mb-1">{i18n.t("home.sessions.empty.description")}</p>
      {props.onCreate && (
        <Button data-action="home-new-session" variant="outline" size="sm" onClick={props.onCreate}>
          <SquarePen aria-hidden className="size-4" />
          {i18n.t("command.session.new")}
        </Button>
      )}
    </div>
  )
}

function HomeSessionSearch(props: {
  server: Server
  showProjectName: boolean
  search: HomeSearch
  actions: HomeSessionActions
}) {
  const i18n = useI18n()
  const search = props.search
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      search.close()
      event.currentTarget.blur()
      return
    }
    if (!search.open || search.results.length === 0 || event.altKey || event.metaKey) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      search.move(event.key === "ArrowDown" ? 1 : -1)
      return
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault()
      search.selectActive()
    }
  }
  return (
    <div ref={search.rootRef} data-component="home-session-search" className="relative z-30 w-full">
      {search.open && (
        <Panel
          data-component="home-session-search-panel"
          className="absolute -start-1.5 -top-1.5 flex w-[calc(100%+12px)] flex-col overflow-hidden shadow-lg"
        >
          <div id={SEARCH_RESULTS_ID} role="listbox" className="flex flex-col gap-4 pt-[52px]">
            {search.loading ? (
              <div className="flex items-center justify-center px-4 py-3">
                <Spinner size={16} label={i18n.t("common.loading")} />
              </div>
            ) : search.results.length === 0 ? (
              <p className="ui-note my-1.5 px-4 pb-2">
                {i18n.t("home.sessions.search.noResults", { query: search.query.trim() })}
              </p>
            ) : (
              <div className="flex flex-col">
                <p className="ui-note my-1.5 ps-[18px] pe-6">{i18n.t("home.sessions.search.sessions")}</p>
                <div
                  ref={search.listRef}
                  className="flex max-h-[min(20rem,40dvh)] flex-col gap-px overflow-y-auto pb-2"
                >
                  {search.results.map((record) => (
                    <SearchResultRow
                      key={homeSearchKey(record)}
                      record={record}
                      server={props.server}
                      showProjectName={props.showProjectName}
                      selected={search.active === homeSearchKey(record)}
                      isOpen={props.actions.isOpen(record.session)}
                      onHighlight={() => search.highlight(record)}
                      onSelect={(options) => search.select(record, options)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}
      <label className="relative z-20 flex h-9 w-full items-center gap-2 rounded-md bg-muted/60 py-1 ps-3 pe-2 text-muted-foreground hover:bg-muted focus-within:bg-muted">
        <Search aria-hidden className="size-4 shrink-0" />
        <input
          ref={search.inputRef}
          className="relative z-20 min-w-0 flex-1 border-0 bg-transparent text-foreground outline-0 placeholder:text-muted-foreground"
          value={search.query}
          placeholder={search.placeholder}
          aria-label={search.placeholder}
          aria-expanded={search.open}
          aria-controls={SEARCH_RESULTS_ID}
          aria-autocomplete="list"
          aria-activedescendant={
            search.active && search.open ? `home-session-search-option-${search.active}` : undefined
          }
          onFocus={search.focus}
          onChange={(event) => search.input(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        {search.query && (
          <IconButton
            icon={X}
            size="xs"
            className="relative z-20 shrink-0"
            aria-label={search.placeholder}
            onClick={() => {
              search.close()
              search.focus()
            }}
          />
        )}
      </label>
    </div>
  )
}

function SearchResultRow(props: {
  record: HomeSessionRecord
  server: Server
  showProjectName: boolean
  selected: boolean
  isOpen: boolean
  onHighlight: () => void
  onSelect: (options: OpenOptions) => void
}) {
  const i18n = useI18n()
  const key = homeSearchKey(props.record)
  const showProject = props.showProjectName && !!props.record.projectName
  return (
    <button
      type="button"
      id={`home-session-search-option-${key}`}
      data-key={key}
      data-component="home-session-search-row"
      data-project-name={showProject}
      role="option"
      aria-selected={props.selected}
      className={`flex h-10 w-full shrink-0 cursor-default items-center gap-2 border-0 py-3 ps-[18px] pe-6 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none ${props.selected ? "bg-accent" : ""}`}
      onMouseEnter={props.onHighlight}
      onMouseDown={(event) => event.button === 1 && event.preventDefault()}
      onClick={(event) => props.onSelect({ background: background(event) })}
      onAuxClick={(event) => {
        if (!background(event)) return
        event.preventDefault()
        props.onSelect({ background: true })
      }}
    >
      <SessionLeading record={props.record} server={props.server} open={props.isOpen} />
      <div data-slot="home-session-labels" className="flex min-w-0 flex-1 items-center gap-1.5">
        <SessionTitle title={sessionLabel(props.record.session, i18n.buff.t)} showProjectName={showProject} search />
        {showProject && <ProjectName name={props.record.projectName} search />}
      </div>
    </button>
  )
}

function HomeSessionRow(props: {
  record: HomeSessionRecord
  server: Server
  showProjectName: boolean
  actions: HomeSessionActions
}) {
  const i18n = useI18n()
  const session = props.record.session
  const title = sessionLabel(session, i18n.buff.t)
  const showProject = props.showProjectName && !!props.record.projectName
  const [editor, setEditor] = useState<{ draft: string; renaming: boolean } | undefined>(undefined)
  const rowRef = useRef<HTMLButtonElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const input = () => editorRef.current?.querySelector<HTMLInputElement>('[data-component="home-session-rename"]')
  const longPress = useRef<{ timer?: ReturnType<typeof setTimeout>; x: number; y: number; suppress: boolean }>({
    x: 0,
    y: 0,
    suppress: false,
  })
  const editing = editor !== undefined

  useEffect(() => {
    if (!editing) return
    input()?.focus()
    input()?.select()
  }, [editing])

  const close = () => {
    if (editor?.renaming) return
    setEditor(undefined)
  }
  const save = async () => {
    if (!editor || editor.renaming) return
    setEditor({ ...editor, renaming: true })
    const saved = await props.actions.rename(session, editor.draft)
    const restore = document.activeElement === document.body || document.activeElement === input()
    setEditor(saved ? undefined : { ...editor, renaming: false })
    if (!restore) return
    requestAnimationFrame(() => (saved ? rowRef.current?.focus() : input()?.focus()))
  }
  const clearLongPress = () => {
    clearTimeout(longPress.current.timer)
    longPress.current.timer = undefined
  }

  const leading = <SessionLeading record={props.record} server={props.server} open={props.actions.isOpen(session)} />
  return (
    <ContextMenu
      disabled={editing}
      onClosed={() => editing || undefined}
      content={
        <>
          <DropdownMenuItem onSelect={() => setEditor({ draft: title, renaming: false })}>
            {i18n.t("common.rename")}
          </DropdownMenuItem>
          {BuffFeatures.sessionTransfer && (
            <DropdownMenuItem onSelect={() => void props.actions.export(session)}>
              {i18n.t("common.export")}…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => props.actions.remove(session)}>{i18n.t("common.delete")}…</DropdownMenuItem>
        </>
      }
    >
      {(trigger) => (
        <div
          data-component="home-session-row-container"
          data-project-name={showProject}
          data-session-id={session.id}
          className="group/session relative flex h-10 min-w-0 items-center rounded-md outline-none"
        >
          {editor ? (
            <div
              ref={editorRef}
              data-slot="home-session-editor"
              className="flex h-10 w-full min-w-0 flex-1 items-center gap-2 py-3 ps-1.5 pe-3 md:ps-3 md:pe-10"
            >
              {leading}
              <div data-slot="home-session-labels" className="contents">
                <InlineInput
                  data-component="home-session-rename"
                  aria-label={i18n.t("common.rename")}
                  dir="auto"
                  value={editor.draft}
                  disabled={editor.renaming}
                  commitOnBlur={false}
                  className={`block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium shadow-none outline-none [field-sizing:content] focus:outline-none ${showProject ? "max-w-[min(70%,480px)] flex-[0_1_auto]" : "flex-[1_1_auto]"}`}
                  style={{
                    textAlign: "start",
                    boxShadow: "none",
                    margin: 0,
                    padding: 0,
                    border: 0,
                    background: "transparent",
                  }}
                  onChange={(event) => {
                    const draft = event.currentTarget.value
                    setEditor((current) => current && { ...current, draft })
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return
                    if (event.key === "Enter") {
                      event.preventDefault()
                      void save()
                      return
                    }
                    if (event.key !== "Escape") return
                    event.preventDefault()
                    close()
                    requestAnimationFrame(() => rowRef.current?.focus())
                  }}
                  onBlur={close}
                />
                {showProject && <ProjectName name={props.record.projectName} />}
              </div>
            </div>
          ) : (
            <button
              {...trigger}
              ref={rowRef}
              type="button"
              data-component="home-session-row"
              className="flex h-10 w-full min-w-0 flex-1 shrink-0 cursor-default items-center gap-2 rounded-md border-0 bg-transparent py-3 ps-1.5 pe-3 text-start font-medium text-muted-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none md:ps-3 md:pe-10"
              onMouseDown={(event) => event.button === 1 && event.preventDefault()}
              onPointerDown={(event) => {
                longPress.current.suppress = false
                if (event.pointerType !== "touch") return
                clearLongPress()
                const element = event.currentTarget
                const x = event.clientX
                const y = event.clientY
                longPress.current = {
                  x,
                  y,
                  suppress: false,
                  timer: setTimeout(() => {
                    longPress.current.suppress = true
                    clearLongPress()
                    element.dispatchEvent(
                      new window.MouseEvent("contextmenu", { bubbles: true, clientX: x, clientY: y }),
                    )
                  }, 500),
                }
              }}
              onPointerMove={(event) => {
                if (!longPress.current.timer) return
                if (
                  Math.abs(event.clientX - longPress.current.x) <= 8 &&
                  Math.abs(event.clientY - longPress.current.y) <= 8
                )
                  return
                clearLongPress()
              }}
              onPointerUp={clearLongPress}
              onPointerCancel={() => {
                clearLongPress()
                longPress.current.suppress = false
              }}
              onKeyDown={(event) => {
                if (event.key !== "ContextMenu" && (event.key !== "F10" || !event.shiftKey)) return
                event.preventDefault()
                event.currentTarget.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true }))
              }}
              onClick={(event) => {
                // A long press opened the menu; its compatibility click must not open the session.
                if (longPress.current.suppress) {
                  longPress.current.suppress = false
                  if (event.detail !== 0) return event.preventDefault()
                }
                props.actions.open(session, { background: background(event) })
              }}
              onAuxClick={(event) => {
                if (!background(event)) return
                event.preventDefault()
                props.actions.open(session, { background: true })
              }}
            >
              {leading}
              <div data-slot="home-session-labels" className="contents">
                <SessionTitle title={title} showProjectName={showProject} />
                {showProject && <ProjectName name={props.record.projectName} />}
              </div>
            </button>
          )}
        </div>
      )}
    </ContextMenu>
  )
}

/** The project mark, or the working spinner; a bar beside it while the session has a tab. */
function SessionLeading(props: { record: HomeSessionRecord; server: Server; open: boolean }) {
  const id = props.record.session.id
  const activity = useServerData(props.server, (state) => sessionActivity(state, id), shallowEqual)
  return (
    <div className="relative shrink-0">
      {props.open && (
        <span
          aria-hidden="true"
          data-slot="home-session-open"
          className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-[2px] bg-border"
          style={{ right: "calc(100% + 4px)" }}
        />
      )}
      {activity.working ? (
        <SessionProgress size={16} />
      ) : (
        <span className="relative flex">
          <ProjectAvatar name={props.record.projectName} size={20} />
          {activity.unread && <span className="absolute -end-0.5 -top-0.5 size-1.5 rounded-full bg-primary" />}
        </span>
      )}
    </div>
  )
}

function SessionTitle(props: { title: string; showProjectName: boolean; search?: boolean }) {
  return (
    <span
      data-component="home-session-title"
      dir="auto"
      className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground ${props.search ? "text-[13px] leading-4" : ""} ${props.showProjectName ? "max-w-[min(70%,480px)] flex-[0_1_auto]" : "flex-[1_1_auto]"}`}
    >
      {props.title}
    </span>
  )
}

function ProjectName(props: { name: string; search?: boolean }) {
  return (
    <span
      data-component="home-session-project-name"
      dir="auto"
      className={`min-w-0 flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground ${props.search ? "text-[13px] leading-4" : ""}`}
    >
      {props.name}
    </span>
  )
}
