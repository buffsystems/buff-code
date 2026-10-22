// Home's projects (#584): the servers and their open projects to filter the session list by, add
// or close a project, start a session in one; on a phone the same list drops down from a button.
// Ported from the Solid Home's projects view (project reordering by drag is not ported yet).

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Panel,
} from "@buff/ui/react"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { ChevronDown, CircleHelp, Ellipsis, Folder, FolderPlus, Settings, SquarePen } from "lucide-react"
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react"
import { serverKey, serverName, type ServerConnection } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { ProjectAvatar } from "../shell/project-avatar"
import { useProjectUnseen } from "../shell/notifications/provider"
import { displayName, type HomeProject, type HomeSelection } from "./model"

export type HomeProjectsProps = {
  servers: ServerConnection[]
  focused: ServerConnection | undefined
  projects: HomeProject[]
  recentlyClosed: string[]
  selection: HomeSelection
  homedir: string
  healthy: (conn: ServerConnection) => boolean
  onFocusServer: (conn: ServerConnection) => void
  onSelectProject: (conn: ServerConnection, directory: string) => void
  onChooseProject: (conn: ServerConnection) => void
  onAddProjects: (conn: ServerConnection, directories: string[]) => void
  onNewSession: (conn: ServerConnection, directory: string) => void
  onEditProject: (conn: ServerConnection, project: HomeProject) => void
  onCloseProject: (conn: ServerConnection, directory: string) => void
  /** Drag reordering: the project goes to the index it was dropped at. */
  onMoveProject: (conn: ServerConnection, directory: string, index: number) => void
  onOpenSettings: () => void
  onOpenHelp: () => void
}

const LABEL = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"

export function HomeProjects(props: HomeProjectsProps & { dropdown?: boolean }) {
  if (props.dropdown) return <HomeProjectsDropdown {...props} />
  return <HomeProjectsPanel {...props} />
}

function HomeProjectsDropdown(props: HomeProjectsProps) {
  const i18n = useI18n()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selected = props.projects.find((project) => project.worktree === props.selection.directory)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
    }
  }, [open])
  const close =
    <Args extends unknown[]>(run: (...args: Args) => void) =>
    (...args: Args) => {
      setOpen(false)
      run(...args)
    }
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        data-component="home-projects-dropdown"
        aria-label={i18n.t("home.projects")}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-start hover:bg-accent"
        onClick={() => setOpen((value) => !value)}
      >
        {selected ? <ProjectAvatar name={displayName(selected)} /> : <Folder aria-hidden className="size-4" />}
        <span className="flex min-w-0 flex-1 flex-col leading-4">
          <bdi className="truncate">{selected ? displayName(selected) : i18n.t("home.projects.all")}</bdi>
          {props.servers.length > 1 && props.focused && (
            <bdi className="truncate text-muted-foreground opacity-70">{serverName(props.focused)}</bdi>
          )}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <Panel
          role="dialog"
          aria-label={i18n.t("home.projects")}
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[70dvh] overflow-hidden p-1.5 shadow-lg"
        >
          <HomeProjectsPanel
            {...props}
            dropdown
            onSelectProject={close(props.onSelectProject)}
            onFocusServer={close(props.onFocusServer)}
            onChooseProject={close(props.onChooseProject)}
            onAddProjects={close(props.onAddProjects)}
            onNewSession={close(props.onNewSession)}
          />
        </Panel>
      )}
    </div>
  )
}

function HomeProjectsPanel(props: HomeProjectsProps & { dropdown?: boolean }) {
  const i18n = useI18n()
  const single = props.servers.length === 1 ? props.servers[0] : undefined
  return (
    <aside
      aria-label={i18n.t("home.projects")}
      className={
        props.dropdown
          ? "flex max-h-[60dvh] min-h-0 min-w-0 flex-col overflow-hidden"
          : "mt-6 flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden lg:sticky lg:top-14 lg:mt-14 lg:self-start lg:pt-[52px]"
      }
    >
      {!props.dropdown && (
        <div className="flex h-7 min-w-0 shrink-0 items-center justify-between ps-1.5 pe-3">
          <div className="text-[14px] font-semibold">{i18n.t("home.projects")}</div>
          {single && !(props.projects.length === 0 && props.recentlyClosed.length > 0) && (
            <IconButton
              data-action="home-add-project"
              icon={FolderPlus}
              size="xs"
              aria-label={i18n.t("home.project.add")}
              disabled={!props.healthy(single)}
              onClick={() => props.onChooseProject(single)}
            />
          )}
        </div>
      )}
      <div data-slot="home-projects-scroll" className="min-h-0 min-w-0 shrink overflow-y-auto">
        {props.dropdown && single && (
          <NavButton
            className="mb-1"
            data-selected={!props.selection.directory ? "" : undefined}
            onClick={() => props.onFocusServer(single)}
          >
            <Folder aria-hidden className="size-4 shrink-0" />
            <span className={LABEL}>{i18n.t("home.projects.all")}</span>
          </NavButton>
        )}
        {single ? (
          <div className={props.dropdown ? "" : "pe-3"}>
            {props.projects.length > 0 ? (
              <>
                <ProjectList {...props} conn={single} />
                {props.dropdown && (
                  <NavButton
                    data-action="home-add-project-row"
                    className="mt-1 disabled:opacity-60"
                    disabled={!props.healthy(single)}
                    onClick={() => props.onChooseProject(single)}
                  >
                    <FolderPlus aria-hidden className="size-4 shrink-0" />
                    <span className={LABEL}>{i18n.t("home.project.add")}</span>
                  </NavButton>
                )}
              </>
            ) : (
              <ProjectsEmpty {...props} conn={single} />
            )}
          </div>
        ) : (
          <div className={`flex min-w-0 flex-col ${props.dropdown ? "gap-1" : "gap-4 pe-3"}`}>
            {props.servers.map((conn) => (
              <ServerSection key={serverKey(conn)} {...props} conn={conn} />
            ))}
          </div>
        )}
      </div>
      {!props.dropdown && <HomeUtilityNav {...props} className="mb-8 mt-4 hidden shrink-0 lg:flex" />}
    </aside>
  )
}

/** A server's row when the window has several; its projects show under it while it is focused. */
function ServerSection(props: HomeProjectsProps & { conn: ServerConnection; dropdown?: boolean }) {
  const i18n = useI18n()
  const key = serverKey(props.conn)
  const focused = !!props.focused && serverKey(props.focused) === key
  const healthy = props.healthy(props.conn)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="group/server relative flex h-7 w-full min-w-0 items-center rounded-md" data-home-row>
        <NavButton
          data-selected={focused && !props.selection.directory ? "" : undefined}
          disabled={!healthy}
          onClick={() => props.onFocusServer(props.conn)}
        >
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform"
            style={{ transform: `rotate(${focused ? 0 : -90}deg)` }}
          />
          <span data-slot="home-row-label" className={`${LABEL} ${healthy ? "" : "opacity-60"}`}>
            {serverName(props.conn)}
          </span>
        </NavButton>
        <div data-slot="home-row-actions" className="absolute inset-y-0 end-1 flex items-center gap-1">
          <IconButton
            data-action="home-add-project"
            icon={FolderPlus}
            size="xs"
            aria-label={i18n.t("home.project.add")}
            disabled={!healthy}
            onClick={() => props.onChooseProject(props.conn)}
          />
        </div>
      </div>
      {focused && healthy && props.projects.length > 0 && (
        <>
          <div className="mx-3 h-px bg-border" />
          <ProjectList {...props} />
        </>
      )}
    </div>
  )
}

/** The projects, sorted by dragging (touch waits a moment, so a flick still scrolls). */
function ProjectList(props: HomeProjectsProps & { conn: ServerConnection; dropdown?: boolean }) {
  const list = useRef<HTMLDivElement>(null)
  return (
    <DragDropProvider
      sensors={[
        PointerSensor.configure({
          activationConstraints: (event) =>
            event.pointerType === "touch"
              ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
              : [new PointerActivationConstraints.Distance({ value: 4 })],
          preventActivation: (event) => event.target instanceof Element && !!event.target.closest("[data-action]"),
        }),
      ]}
      modifiers={[RestrictToVerticalAxis, RestrictToElement.configure({ element: () => list.current })]}
      plugins={(defaults) => [
        ...defaults.filter((plugin) => plugin !== Accessibility && plugin !== AutoScroller && plugin !== Feedback),
        AutoScroller.configure({ acceleration: 8, threshold: { x: 0, y: 0.05 } }),
        Feedback.configure({ dropAnimation: null }),
      ]}
      onDragEnd={(event) => {
        const source = event.operation.source
        if (event.canceled || !isSortable(source)) return
        if (source.initialIndex !== source.index) props.onMoveProject(props.conn, String(source.id), source.index)
        if (props.selection.server !== serverKey(props.conn)) props.onSelectProject(props.conn, String(source.id))
      }}
    >
      <div ref={list} className="flex min-w-0 flex-col gap-1">
        {props.projects.map((project, index) => (
          <ProjectRow key={project.worktree} {...props} project={project} index={index} />
        ))}
      </div>
    </DragDropProvider>
  )
}

function ProjectRow(
  props: HomeProjectsProps & { conn: ServerConnection; project: HomeProject; index: number; dropdown?: boolean },
) {
  const i18n = useI18n()
  const sortable = useSortable({ id: props.project.worktree, index: props.index })
  const [menu, setMenu] = useState(false)
  const pressed = useRef<boolean | undefined>(undefined)
  const selected = props.selection.directory === props.project.worktree
  const healthy = props.healthy(props.conn)
  const name = displayName(props.project)
  const unseen = useProjectUnseen(serverKey(props.conn), [props.project.worktree, ...(props.project.sandboxes ?? [])])
  return (
    <div
      ref={sortable.ref}
      className={`group/project relative flex h-7 min-w-0 items-center rounded-md ${sortable.isDragSource ? "z-10" : ""}`}
      data-home-row
      data-dragging={sortable.isDragSource || undefined}
      data-selected={selected ? "" : undefined}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu(true)
      }}
    >
      <NavButton
        data-component="home-project-row"
        className="disabled:opacity-60"
        data-selected={selected ? "" : undefined}
        aria-current={selected ? "page" : undefined}
        disabled={!healthy}
        onPointerDown={(event) => {
          // Mouse selection happens on press, like tabs, but only ever selects; a plain click on
          // the selected row toggles it off. Touch keeps the click so a scroll never selects.
          pressed.current = undefined
          if (props.dropdown || event.button !== 0 || event.pointerType === "touch") return
          pressed.current = selected
          if (!selected) props.onSelectProject(props.conn, props.project.worktree)
        }}
        onClick={(event) => {
          // The drag sensor prevents the click that ends a drag: a reorder never toggles selection.
          if (event.defaultPrevented) return
          if (event.detail === 0 || pressed.current === undefined) {
            props.onSelectProject(props.conn, props.project.worktree)
            return
          }
          if (pressed.current) props.onSelectProject(props.conn, props.project.worktree)
          pressed.current = undefined
        }}
      >
        <ProjectAvatar name={name} />
        <span data-slot="home-row-label" className={LABEL}>
          {name}
        </span>
      </NavButton>
      <div
        data-slot="home-row-actions"
        data-menu={menu}
        className="absolute inset-y-0 end-1 flex items-center gap-1 opacity-0 group-hover/project:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
      >
        <DropdownMenu open={menu} onOpenChange={setMenu} modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton
              data-action="home-project-menu"
              icon={Ellipsis}
              size="xs"
              aria-label={i18n.t("common.moreOptions")}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent data-component="menu-v2-content" align="end">
            <DropdownMenuItem onSelect={() => props.onNewSession(props.conn, props.project.worktree)}>
              {i18n.t("command.session.new")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onEditProject(props.conn, props.project)}>
              {i18n.t("dialog.project.edit.title")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={unseen.count === 0} onSelect={unseen.markViewed}>
              {i18n.t("sidebar.project.clearNotifications")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => props.onCloseProject(props.conn, props.project.worktree)}>
              {i18n.t("common.close")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          data-action="home-project-new-session"
          icon={SquarePen}
          size="xs"
          aria-label={i18n.t("command.session.new")}
          onClick={() => props.onNewSession(props.conn, props.project.worktree)}
        />
      </div>
    </div>
  )
}

function ProjectsEmpty(props: HomeProjectsProps & { conn: ServerConnection }) {
  const i18n = useI18n()
  const healthy = props.healthy(props.conn)
  const path = (worktree: string) => {
    const home = props.homedir
    if (home && (worktree === home || worktree.startsWith(`${home}/`))) return `~${worktree.slice(home.length)}`
    return worktree
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <NavButton
        data-action="home-add-project-row"
        className="disabled:opacity-60"
        disabled={!healthy}
        onClick={() => props.onChooseProject(props.conn)}
      >
        <FolderPlus aria-hidden className="size-4 shrink-0" />
        <span className={LABEL}>{i18n.t("home.project.add")}</span>
      </NavButton>
      {props.recentlyClosed.length > 0 && (
        <>
          <div className="mt-3 flex h-7 min-w-0 shrink-0 items-center ps-1.5 pe-3 font-medium text-muted-foreground">
            {i18n.t("home.recentlyClosed")}
          </div>
          {props.recentlyClosed.map((worktree) => (
            <NavButton
              key={worktree}
              data-component="home-recently-closed-row"
              className="disabled:opacity-60"
              title={path(worktree)}
              disabled={!healthy}
              onClick={() => props.onAddProjects(props.conn, [worktree])}
            >
              <ProjectAvatar name={displayName({ worktree })} />
              <span className={LABEL}>{displayName({ worktree })}</span>
            </NavButton>
          ))}
        </>
      )}
    </div>
  )
}

export function HomeUtilityNav(props: { className?: string; onOpenSettings: () => void; onOpenHelp: () => void }) {
  const i18n = useI18n()
  return (
    <div
      className={`${props.className ?? ""} min-w-0 flex-row justify-between gap-1 lg:flex-col lg:justify-start lg:pe-3 [&>button]:w-auto lg:[&>button]:w-full`}
    >
      <NavButton className="text-muted-foreground" onClick={props.onOpenSettings}>
        <Settings aria-hidden className="size-4 shrink-0" />
        <span className={LABEL}>{i18n.t("sidebar.settings")}</span>
      </NavButton>
      <NavButton className="text-muted-foreground" onClick={props.onOpenHelp}>
        <CircleHelp aria-hidden className="size-4 shrink-0" />
        <span className={LABEL}>{i18n.t("sidebar.help")}</span>
      </NavButton>
    </div>
  )
}

function NavButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-7 w-full min-w-0 shrink-0 cursor-default items-center gap-2 rounded-md bg-transparent px-1.5 text-start text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none data-[selected]:bg-accent data-[selected]:text-foreground ${props.className ?? ""}`}
    />
  )
}
