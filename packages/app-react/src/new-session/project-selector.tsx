// Which project the draft starts in (#584): the open projects of every server, searchable, and
// adding one. Ported from the Solid PromptProjectSelector onto the design system's menu.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@buff/ui/react"
import { pathKey } from "@opencode/app/react-reuse/path-key"
import { ChevronDown, FolderPlus, Plus, Search, X } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { displayName } from "../home/model"
import { useI18n } from "../i18n/provider"
import { ProjectAvatar } from "../shell/project-avatar"

export type PromptProject = {
  name?: string
  id?: string
  worktree: string
  sandboxes?: readonly string[]
  server?: { key: string; name: string }
}

export type ProjectControls = {
  available: PromptProject[]
  directory: string
  server?: string
  select: (worktree: string, server?: string) => void
  add: (server?: string) => void
}

/** The project the draft's directory belongs to, else the first one. */
export function selectedProject(controls: ProjectControls) {
  const key = pathKey(controls.directory)
  return (
    controls.available.find(
      (project) =>
        (!project.server || project.server.key === controls.server) &&
        (pathKey(project.worktree) === key || project.sandboxes?.some((sandbox) => pathKey(sandbox) === key)),
    ) ?? controls.available[0]
  )
}

export function ProjectSelector(props: {
  controls: ProjectControls
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const i18n = useI18n()
  const [search, setSearch] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const project = selectedProject(props.controls)
  const query = search.trim().toLowerCase()
  const projects = query
    ? props.controls.available.filter((item) => displayName(item).toLowerCase().includes(query))
    : props.controls.available
  const servers = props.controls.available
    .flatMap((item) => (item.server ? [item.server] : []))
    .filter((server, index, all) => all.findIndex((item) => item.key === server.key) === index)
  useEffect(() => {
    if (!props.open) return setSearch("")
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => input.current?.focus({ preventScroll: true })),
    )
    return () => cancelAnimationFrame(frame)
  }, [props.open])
  const select = (item: PromptProject) => {
    if (pathKey(item.worktree) !== pathKey(project?.worktree ?? "") || item.server?.key !== project?.server?.key)
      props.controls.select(item.worktree, item.server?.key)
  }
  const item = (entry: PromptProject) => (
    <DropdownMenuItem
      key={`${entry.server?.key ?? ""}\n${entry.worktree}`}
      role="menuitemradio"
      aria-checked={entry === project}
      onSelect={() => select(entry)}
    >
      <ProjectAvatar name={displayName(entry)} />
      <span className="ui-menu__text min-w-0 truncate">{displayName(entry)}</span>
    </DropdownMenuItem>
  )
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (["Escape", "ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) return
    event.stopPropagation()
  }
  return (
    <DropdownMenu
      open={props.open}
      modal={false}
      onOpenChange={(open) => {
        props.onOpenChange(open)
        if (!open) props.onDone?.()
      }}
    >
      <DropdownMenuTrigger
        data-action="prompt-project"
        className="flex h-7 min-w-0 max-w-[203px] items-center gap-1.5 rounded-sm px-1.5 hover:bg-accent data-[state=open]:bg-accent"
      >
        {project ? (
          <ProjectAvatar name={displayName(project)} />
        ) : (
          <FolderPlus aria-hidden className="size-4 shrink-0" />
        )}
        <span className="min-w-0 truncate leading-5">
          {project ? displayName(project) : i18n.t("session.new.project.new")}
        </span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent id="prompt-project-menu" align="center" className="w-[240px] p-0">
        <div className="flex h-8 items-center gap-2 border-b ps-3 pe-2 text-muted-foreground">
          <Search aria-hidden className="size-3.5 shrink-0" />
          <input
            ref={input}
            value={search}
            placeholder={i18n.t("session.new.project.search")}
            aria-label={i18n.t("session.new.project.search")}
            className="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none"
            onChange={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          {search.trim() && (
            <button
              type="button"
              aria-label={i18n.t("common.clear")}
              className="flex size-5 items-center justify-center rounded-sm hover:bg-accent"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                setSearch("")
                input.current?.focus()
              }}
            >
              <X aria-hidden className="size-3.5" />
            </button>
          )}
        </div>
        <div className="max-h-[224px] overflow-y-auto p-1">
          {servers.length > 1
            ? servers.map((server) => (
                <div key={server.key}>
                  <DropdownMenuLabel>{server.name}</DropdownMenuLabel>
                  {projects.filter((entry) => entry.server?.key === server.key).map(item)}
                </div>
              ))
            : projects.map(item)}
        </div>
        <DropdownMenuSeparator />
        <div className="p-1">
          {servers.length > 1 ? (
            servers.map((server) => (
              <DropdownMenuItem key={server.key} onSelect={() => props.controls.add(server.key)}>
                <Plus aria-hidden />
                <span className="ui-menu__text min-w-0 truncate">
                  {i18n.t("session.new.project.add")} · {server.name}
                </span>
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem onSelect={() => props.controls.add(servers[0]?.key)}>
              <Plus aria-hidden />
              <span className="ui-menu__text min-w-0 truncate">{i18n.t("session.new.project.add")}</span>
            </DropdownMenuItem>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** With no project open yet: one button that adds the first. */
export function ProjectAddButton(props: { onAdd: () => void }) {
  const i18n = useI18n()
  return (
    <button
      type="button"
      data-action="prompt-project"
      className="mx-auto flex h-7 min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-muted-foreground hover:bg-accent"
      onClick={props.onAdd}
    >
      <FolderPlus aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 truncate leading-5">{i18n.t("session.new.project.new")}</span>
      <ChevronDown aria-hidden className="size-3.5 shrink-0" />
    </button>
  )
}
