// The window's tabs (#584): the open tabs across the titlebar or down the sidebar, on @buff/ui's
// TabStrip look. A tab navigates on mouse down, closes on its button or a middle click, renames in
// place from its context menu or a double click, and shows its project or the working indicator.
// The tabs are links to their sessions, as in the Solid window, not a tablist: a `nav` strip.

import { DropdownMenuItem, TabStrip, TabStripTab, TabStripTrigger } from "@buff/ui/react"
import { sessionTabTitle } from "@opencode/app/react-reuse/tab-title"
import { adjacentTabKey, mergeVisibleTabOrder } from "@opencode/app/react-reuse/tab-order"
import { RestrictToHorizontalAxis, RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@dnd-kit/helpers"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import type { SessionInfo } from "@opencode/client/promise"
import { PencilLine } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react"
import { useCommandRegistration } from "../../commands/provider"
import { serverKey, type ServerConnection } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useConnection, useCore, useServerData, useServers } from "../../react/core"
import { useStore } from "../../react/use-store"
import { ContextMenu } from "../menu/context-menu"
import { useShellSettings } from "../settings-context"
import { useSessionUnseen } from "../notifications/provider"
import { showToast } from "../notifications/toast"
import { ProjectAvatar, SessionProgress } from "../project-avatar"
import { displayName } from "../../home/model"
import { useCurrentTab, useTabList, useTabs } from "./provider"
import { tabHref, tabKey, type DraftTab, type SessionTab, type Tab } from "./tabs"
import { useSessionActivity } from "./activity"

const MIDDLE_BUTTON = 1

export type TabOrientation = "horizontal" | "vertical"

export function WindowTabs(props: { orientation: TabOrientation; onNavigate?: (tab: Tab) => void }) {
  const i18n = useI18n()
  const tabs = useTabs()
  const list = useTabList()
  const current = useCurrentTab()
  const vertical = props.orientation === "vertical"
  // Tabs whose session is still loading are hidden; keyboard order skips them.
  const listRef = useRef<HTMLDivElement>(null)
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})
  const visibleChange = (key: string, visible: boolean) =>
    setVisibility((current) => (current[key] === visible ? current : { ...current, [key]: visible }))
  const navigate = (tab: Tab) => {
    tabs.select(tab)
    props.onNavigate?.(tab)
  }
  const close = (tab: Tab) => {
    const index = tabs.tabs().findIndex((item) => tabKey(item) === tabKey(tab))
    if (index !== -1) tabs.closeTab(index)
  }
  const shown = list.filter((tab) => tab.type === "draft" || visibility[tabKey(tab)])
  const order = shown.map(tabKey)
  const step = (offset: -1 | 1) => {
    const key = adjacentTabKey(order, current ? tabKey(current) : undefined, offset)
    const next = list.find((tab) => tabKey(tab) === key)
    if (next) navigate(next)
  }
  useCommandRegistration(`tab-strip-${props.orientation}`, () => [
    {
      id: "tab.prev",
      title: "",
      keybind: "mod+option+ArrowLeft,ctrl+shift+tab",
      hidden: true,
      onSelect: () => step(-1),
    },
    {
      id: "tab.next",
      title: "",
      keybind: "mod+option+ArrowRight,ctrl+tab",
      hidden: true,
      onSelect: () => step(1),
    },
    // The menu's Go › Previous/Next session: the window's sessions are its tabs.
    {
      id: "session.previous",
      title: i18n.t("command.session.previous"),
      category: i18n.t("command.category.session"),
      onSelect: () => step(-1),
    },
    {
      id: "session.next",
      title: i18n.t("command.session.next"),
      category: i18n.t("command.category.session"),
      onSelect: () => step(1),
    },
    ...shown.slice(0, 9).map((tab, index) => ({
      id: `tab.${index + 1}`,
      title: "",
      keybind: `mod+${index + 1}`,
      hidden: true,
      onSelect: () => navigate(tab),
    })),
  ])
  return (
    <div
      data-slot={vertical ? "vertical-tabs" : "titlebar-tabs"}
      data-orientation={props.orientation}
      className={vertical ? "relative min-h-0 min-w-0 overflow-hidden" : "relative min-w-0"}
    >
      <div
        data-slot={vertical ? "vertical-tabs-scroll" : "titlebar-tabs-scroll"}
        className={
          vertical
            ? "flex max-h-full min-w-0 flex-col overflow-y-auto overflow-x-hidden"
            : "flex min-w-0 flex-row items-center gap-1.5 overflow-x-auto [scrollbar-width:none]"
        }
      >
        <DragDropProvider
          sensors={[
            PointerSensor.configure({
              activationConstraints: (event) => [
                new PointerActivationConstraints.Distance({ value: event.pointerType === "touch" ? 8 : 4 }),
              ],
              preventActivation: (event) =>
                event.target instanceof Element &&
                (!!event.target.closest(".ui-tab-strip__close") || !!event.target.closest('[contenteditable="true"]')),
            }),
          ]}
          modifiers={[
            vertical ? RestrictToVerticalAxis : RestrictToHorizontalAxis,
            RestrictToElement.configure({ element: () => listRef.current }),
          ]}
          plugins={(defaults) => [
            ...defaults.filter((plugin) => plugin !== Accessibility),
            AutoScroller.configure({ acceleration: 8, threshold: vertical ? { x: 0, y: 0.05 } : { x: 0.05, y: 0 } }),
            Feedback.configure({ dropAnimation: null }),
          ]}
          onDragStart={(event) => {
            if (vertical) return
            const tab = list.find((item) => tabKey(item) === String(event.operation.source?.id))
            if (tab) navigate(tab)
          }}
          onDragEnd={(event) => {
            const source = event.operation.source
            if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
            tabs.reorder(
              mergeVisibleTabOrder(list.map(tabKey), order, arrayMove(order, source.initialIndex, source.index)),
            )
          }}
        >
          <TabStrip
            ref={listRef}
            orientation={props.orientation}
            nav
            data-titlebar-tab-list
            className="w-full"
          >
            {list.map((tab, index) =>
              tab.type === "session" ? (
                <SessionTabEntry
                  key={tabKey(tab)}
                  index={index}
                  sortIndex={order.indexOf(tabKey(tab))}
                  tab={tab}
                  active={!!current && tabKey(current) === tabKey(tab)}
                  orientation={props.orientation}
                  onNavigate={() => navigate(tab)}
                  onClose={() => close(tab)}
                  onVisibleChange={(visible) => visibleChange(tabKey(tab), visible)}
                />
              ) : (
                <DraftTabEntry
                  key={tabKey(tab)}
                  index={index}
                  sortIndex={order.indexOf(tabKey(tab))}
                  tab={tab}
                  active={!!current && tabKey(current) === tabKey(tab)}
                  orientation={props.orientation}
                  onNavigate={() => navigate(tab)}
                  onClose={() => close(tab)}
                />
              ),
            )}
          </TabStrip>
        </DragDropProvider>
      </div>
    </div>
  )
}

type EntryProps<T extends Tab> = {
  tab: T
  index: number
  /** The tab's place among the shown tabs, for sorting by drag. */
  sortIndex: number
  active: boolean
  orientation: TabOrientation
  onNavigate: () => void
  onClose: () => void
}

type SessionEntryProps = EntryProps<SessionTab> & { onVisibleChange: (visible: boolean) => void }

function SessionTabEntry(props: SessionEntryProps) {
  const conn = useServers().find((item) => serverKey(item) === props.tab.server)
  const tabs = useTabs()
  const stored = useStore(tabs.info, (info) => info[tabKey(props.tab)])
  const offline = !conn
  useEffect(() => {
    if (offline) props.onVisibleChange(!!stored?.title)
  }, [offline, !!stored?.title])
  if (!conn) {
    if (!stored?.title) return null
    return <TabItem {...props} title={stored.title} />
  }
  return <ConnectedSessionTab {...props} conn={conn} />
}

function ConnectedSessionTab(props: SessionEntryProps & { conn: ServerConnection }) {
  const i18n = useI18n()
  const tabs = useTabs()
  const server = useCore().registry.ensure(props.conn)
  const id = props.tab.sessionId
  const session = useServerData(server, (state) => state.session.info[id])
  const stored = useStore(tabs.info, (info) => info[tabKey(props.tab)])
  // A session being prepared (a new worktree first) does not exist yet: it shows as working.
  const pending = useStore(tabs.pending, (all) => !!all[tabKey(props.tab)])
  const [missing, setMissing] = useState(false)
  const activity = useSessionActivity(server, id)
  const unseen = useSessionUnseen(server.key, id)
  const projectName = useServerData(server, (state) => {
    if (!session) return undefined
    const project = Object.values(state.project.info).find((item) => item.id === session.projectID)
    return displayName(
      project ? { name: project.name, worktree: project.canonical } : { worktree: session.location.directory },
    )
  })

  useEffect(() => {
    if (session || pending) return
    const current = { live: true }
    void server.data.session.sync(id).catch(() => current.live && setMissing(true))
    return () => {
      current.live = false
    }
  }, [server, id, !!session, pending])

  useEffect(() => {
    if (session) tabs.rememberSessionInfo(props.tab, session)
  }, [session?.title, session?.location.directory])

  // A tab's family (its subagents) and its waiting requests load in the background, staggered,
  // so the working indicator and the attention mark are right before the tab is opened.
  const connected = useConnection(server).status === "connected"
  const known = !!session
  useEffect(() => {
    if (!known || !connected) return
    const timer = setTimeout(
      () =>
        void Promise.allSettled([
          server.data.session.sync(id, { children: true }),
          server.data.session.permission.sync(id),
          server.data.session.form.sync(id),
        ]),
      props.active ? 0 : 300 + props.index * 50,
    )
    return () => clearTimeout(timer)
  }, [server, id, known, connected, props.active, props.index])

  const rename = async (title: string) => {
    if (!session) return
    server.data.session.remember({ ...session, title })
    try {
      await server.api().session.update({ sessionID: session.id, title })
    } catch (error) {
      server.data.session.remember(session)
      showToast({
        title: i18n.t("common.requestFailed"),
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const fallback = stored?.title ?? (missing ? i18n.t("session.tab.unknown") : undefined)
  const visible = !!session || missing || !!stored?.title || pending
  useEffect(() => props.onVisibleChange(visible), [visible])
  if (!visible) return null
  return (
    <TabItem
      {...props}
      title={sessionTabTitle(session ? session.title : fallback, i18n.t("session.tab.session"))}
      session={session}
      projectName={projectName}
      working={activity.working || pending}
      unread={activity.unread || unseen.count > 0}
      onRename={session ? rename : undefined}
    />
  )
}

function DraftTabEntry(props: EntryProps<DraftTab>) {
  const i18n = useI18n()
  return <TabItem {...props} title={i18n.t("session.tab.session")} draft />
}

function TabItem(
  props: EntryProps<Tab> & {
    title: string
    draft?: boolean
    session?: SessionInfo
    projectName?: string
    working?: boolean
    unread?: boolean
    onRename?: (title: string) => Promise<void>
  },
) {
  const i18n = useI18n()
  const [editing, setEditing] = useState(false)
  const renameAfterClose = useRef(false)
  const titleRef = useRef<HTMLSpanElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef<HTMLAnchorElement>(null)
  const vertical = props.orientation === "vertical"
  const sortable = useSortable({ id: tabKey(props.tab), index: props.sortIndex })
  const showProjectName = useShellSettings((settings) => settings.showProjectName)
  const overflow = useTitleOverflow(titleRef, rootRef, editing, props.title)

  const openRename = () => {
    if (!props.onRename || !props.session || editing) return
    setEditing(true)
  }
  const finish = useRename({
    editing,
    setEditing,
    titleRef,
    rootRef,
    original: props.session?.title ?? "",
    onRename: props.onRename,
  })

  const close = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }
  return (
    <div
      ref={sortable.ref}
      data-titlebar-tab-slot
      data-tab-key={tabKey(props.tab)}
      data-active={props.active}
      data-orientation={props.orientation}
      className={vertical ? "relative flex w-full shrink-0" : "relative flex w-56 min-w-7 max-w-56 shrink"}
    >
      <ContextMenu
        disabled={editing}
        onClosed={() => {
          if (!renameAfterClose.current) return
          renameAfterClose.current = false
          openRename()
          return true
        }}
        content={
          <>
            {!props.draft && (
              <DropdownMenuItem disabled={!props.onRename} onSelect={() => (renameAfterClose.current = true)}>
                {i18n.t("common.rename")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={props.onClose}>{i18n.t("common.closeTab")}</DropdownMenuItem>
          </>
        }
      >
        {(trigger) => (
          <TabStripTab
            ref={rootRef}
            active={props.active}
            dragging={sortable.isDragSource}
            data-titlebar-tab
            data-slot="titlebar-tab-item"
            data-orientation={props.orientation}
            data-editing={editing}
            data-title-overflow={overflow}
            data-state={props.active ? "pressed" : undefined}
            className="whitespace-nowrap"
            onClose={props.onClose}
            closeLabel={i18n.t("common.closeTab")}
            closeProps={{ "data-slot": "tab-close", "data-component": "icon-button-v2" }}
            onMouseDown={(event) => {
              if (event.button === MIDDLE_BUTTON) event.preventDefault()
            }}
            onAuxClick={(event) => {
              if (event.button === MIDDLE_BUTTON) close(event)
            }}
          >
            <TabStripTrigger asChild selected={props.active}>
              <a
                {...trigger}
                ref={linkRef}
                data-slot="tab-link"
                data-titlebar-tab-link
                href={tabHref(props.tab)}
                draggable={false}
                onMouseDown={(event) => {
                  // Navigate on press, not release: tab switches skip the click delay.
                  if (event.button !== 0 || editing) return
                  props.onNavigate()
                }}
                onClick={(event) => {
                  event.preventDefault()
                  // A mouse press already navigated; detail 0 is keyboard activation.
                  if (event.detail > 0 || editing) return
                  props.onNavigate()
                }}
              >
                <span data-slot="project-avatar-slot" className="flex size-4 shrink-0 items-center justify-center">
                  {props.draft ? (
                    <PencilLine aria-hidden className="size-4" />
                  ) : props.working ? (
                    <SessionProgress />
                  ) : props.session ? (
                    <span className="relative flex">
                      <ProjectAvatar name={props.projectName ?? props.title} />
                      {props.unread && (
                        <span
                          data-slot="tab-unread"
                          className="absolute -end-0.5 -top-0.5 size-1.5 rounded-full bg-primary"
                        />
                      )}
                    </span>
                  ) : (
                    <span className="block size-4 rounded-[3px] border" aria-hidden="true" />
                  )}
                </span>
                <TabTitle
                  titleRef={titleRef}
                  title={props.title}
                  editing={editing}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    openRename()
                  }}
                  onFinish={finish}
                />
                {vertical && showProjectName && props.projectName && !props.draft && (
                  <span
                    data-slot="tab-project"
                    dir="auto"
                    className="min-w-0 shrink truncate text-xs text-muted-foreground"
                  >
                    {props.projectName}
                  </span>
                )}
              </a>
            </TabStripTrigger>
          </TabStripTab>
        )}
      </ContextMenu>
    </div>
  )
}

function TabTitle(props: {
  titleRef: RefObject<HTMLSpanElement | null>
  title: string
  editing: boolean
  onDoubleClick: (event: MouseEvent) => void
  onFinish: (save: boolean) => void
}) {
  const ref = props.titleRef
  // While editing the DOM owns the text; React must not reconcile it under the caret.
  useEffect(() => {
    const element = ref.current
    if (!element || props.editing) return
    element.textContent = props.title
  }, [props.title, props.editing])
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!props.editing) return
    event.stopPropagation()
    if (event.key === "Enter") {
      event.preventDefault()
      props.onFinish(true)
      return
    }
    if (event.key !== "Escape") return
    event.preventDefault()
    props.onFinish(false)
  }
  return (
    <span
      ref={ref}
      data-slot="tab-title"
      data-titlebar-tab-title
      dir="auto"
      className={
        props.editing
          ? "min-w-0 flex-1 select-text overflow-hidden whitespace-nowrap leading-4 outline-none"
          : "min-w-0 flex-1 overflow-hidden text-clip whitespace-nowrap leading-4 outline-none"
      }
      contentEditable={props.editing || undefined}
      suppressContentEditableWarning
      onDoubleClick={props.onDoubleClick}
      onKeyDown={onKeyDown}
      onBlur={() => props.editing && props.onFinish(true)}
      onPointerDown={(event) => props.editing && event.stopPropagation()}
      onClick={(event) => props.editing && event.preventDefault()}
    />
  )
}

/** Whether the title is wider than its room; observed on the tab's stable box, not the title. */
function useTitleOverflow(
  titleRef: RefObject<HTMLSpanElement | null>,
  rootRef: RefObject<HTMLDivElement | null>,
  editing: boolean,
  title: string,
) {
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const element = titleRef.current
      setOverflow(!editing && !!element && element.scrollWidth > element.clientWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [editing, title])
  return overflow
}

/** In-place rename: focus and select the title, save on Enter, blur or a press outside; Escape cancels. */
function useRename(input: {
  editing: boolean
  setEditing: (editing: boolean) => void
  titleRef: RefObject<HTMLSpanElement | null>
  rootRef: RefObject<HTMLDivElement | null>
  original: string
  onRename?: (title: string) => Promise<void>
}) {
  const pending = useRef(false)
  const finish = (save: boolean) => {
    const element = input.titleRef.current
    if (!element || pending.current || !input.editing) return
    const next = (element.textContent ?? "").trim()
    element.scrollLeft = 0
    input.setEditing(false)
    if (!save || !next || next === input.original || !input.onRename) {
      element.textContent = input.original
      return
    }
    pending.current = true
    void input.onRename(next).finally(() => {
      pending.current = false
    })
  }
  const latest = useRef(finish)
  latest.current = finish
  useEffect(() => {
    if (!input.editing) return
    const element = input.titleRef.current
    if (!element) return
    element.textContent = input.original
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && input.rootRef.current?.contains(event.target)) return
      latest.current(true)
    }
    document.addEventListener("pointerdown", outside, { capture: true })
    return () => document.removeEventListener("pointerdown", outside, { capture: true })
  }, [input.editing])
  return finish
}
