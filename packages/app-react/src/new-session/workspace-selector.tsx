// Where the draft's session runs (#584): Local, a new worktree (from a base branch) or an existing
// worktree (a submenu) — inline under the composer and as rows in «Session details». Ported from the
// Solid PromptWorkspaceSelector onto the design system's menu.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from "@buff/ui/react"
import { sameDirectory } from "@opencode/app/react-reuse/workspace-paths"
import { getFilename } from "@opencode/util/path"
import { Check, ChevronDown, GitBranch, GitFork, Monitor, Plus, Search, X } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useI18n } from "../i18n/provider"

export function WorkspaceSelector(props: {
  value: string
  projectRoot: string
  workspaces: string[]
  branches: string[]
  branch?: string
  variant?: "inline" | "summary"
  onChange: (value: string) => void
  onCreate: (branch: string) => void
  onSearch: (search: string) => void
  onDone?: () => void
  /** «View all»: the worktrees in settings. */
  onViewAll: () => void
}) {
  const i18n = useI18n()
  const summary = props.variant === "summary"
  const selected = sameDirectory(props.value, props.projectRoot) ? "main" : props.value
  const Icon = selected === "main" ? Monitor : selected === "create" ? Plus : GitFork
  const label =
    selected === "main"
      ? i18n.t(summary ? "session.new.workspace.local" : "session.new.workspace.triggerLocal")
      : selected === "create"
        ? i18n.t("workspace.new")
        : getFilename(props.value)
  const existing = i18n.t("session.new.workspace.existing").replace(/(…|\.{3})$/, "")
  const [search, setSearch] = useState("")
  // Only a choice returns to the prompt; a dismissed menu hands the focus back to its trigger.
  const acted = useRef(false)
  const choose = (value: string) => {
    acted.current = true
    props.onChange(value)
  }
  const visible = search.trim()
    ? props.workspaces.filter((item) => getFilename(item).toLowerCase().includes(search.trim().toLowerCase()))
    : props.workspaces
  return (
    <>
      {!summary && (
        <span aria-hidden="true" className="mx-1 hidden select-none opacity-50 sm:inline">
          /
        </span>
      )}
      <DropdownMenu
        modal={!summary}
        // The submenu opens toward the reading direction (ArrowLeft in a right-to-left document).
        dir={document.documentElement.dir === "rtl" ? "rtl" : "ltr"}
        onOpenChange={(open) => {
          if (open) setSearch("")
          if (!open && acted.current) props.onDone?.()
          acted.current = false
        }}
      >
        <Tooltip content={i18n.t("session.new.workspace.trigger.tooltip")}>
          <DropdownMenuTrigger
            aria-description={i18n.t("session.new.workspace.trigger.tooltip")}
            data-slot="workspace-trigger"
            className={
              summary
                ? "session-summary-row flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-accent"
                : "flex h-6 min-w-0 max-w-[203px] items-center gap-1.5 rounded-sm px-1.5 hover:bg-accent data-[state=open]:bg-accent"
            }
          >
            <Icon
              aria-hidden
              className={`size-4 shrink-0 ${selected === "main" || selected === "create" || summary ? "text-muted-foreground" : "text-primary"}`}
            />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent
          aria-label={label}
          side={summary ? (document.documentElement.dir === "rtl" ? "right" : "left") : "bottom"}
          // Beside «Session details», clear of its card (the trigger sits inside the card's padding).
          sideOffset={summary ? 8 : undefined}
          align="start"
          className="w-[200px]"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>{i18n.t("session.new.workspace.runIn")}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => choose("main")}>
              <Monitor aria-hidden />
              <span
                className="ui-menu__text min-w-0 flex-1 truncate"
                title={i18n.t("session.new.workspace.local.tooltip")}
              >
                {i18n.t("session.new.workspace.local")}
              </span>
              {selected === "main" && <Check aria-hidden className="ui-menu__check" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => choose("create")}>
              <Plus aria-hidden />
              <span
                className="ui-menu__text min-w-0 flex-1 truncate"
                title={i18n.t("session.new.workspace.new.tooltip")}
              >
                {i18n.t("workspace.new")}
              </span>
              {selected === "create" && <Check aria-hidden className="ui-menu__check" />}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {props.workspaces.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub onOpenChange={(open) => open && setSearch("")}>
                <DropdownMenuSubTrigger>
                  <GitFork aria-hidden />
                  <span className="ui-menu__text min-w-0 flex-1 truncate">{existing}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-[66.667dvh] w-[200px] overflow-y-auto">
                  {props.workspaces.length >= 10 && (
                    <MenuSearch
                      value={search}
                      label={i18n.t("session.new.workspace.search.placeholder")}
                      onChange={setSearch}
                      focus
                    />
                  )}
                  {visible.map((workspace) => (
                    <DropdownMenuItem key={workspace} onSelect={() => choose(workspace)}>
                      <GitFork aria-hidden />
                      <span className="ui-menu__text min-w-0 flex-1 truncate">{getFilename(workspace)}</span>
                      {selected === workspace && <Check aria-hidden className="ui-menu__check" />}
                    </DropdownMenuItem>
                  ))}
                  {search.trim() && visible.length === 0 && (
                    <div className="px-3 py-4 text-center text-[13px] text-muted-foreground">
                      {i18n.t("session.new.workspace.search.empty")}
                    </div>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={props.onViewAll}>
                    <span className="ui-menu__text min-w-0 flex-1 truncate">{i18n.t("common.viewAll")}</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {selected === "create" && props.branch ? (
        <BranchSelector
          branch={props.branch}
          branches={props.branches}
          summary={summary}
          onSearch={props.onSearch}
          onSelect={props.onCreate}
          onDone={props.onDone}
        />
      ) : summary ? (
        props.branch && (
          <div className="session-summary-row flex items-center gap-2 px-2 py-1.5">
            <GitBranch aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span dir="auto" className="min-w-0 truncate">
              {props.branch}
            </span>
          </div>
        )
      ) : (
        <GitStatus branch={props.branch} from={selected === "create"} />
      )}
    </>
  )
}

/** The base branch of a new worktree, searchable. */
function BranchSelector(props: {
  branch: string
  branches: string[]
  summary: boolean
  onSearch: (search: string) => void
  onSelect: (branch: string) => void
  onDone?: () => void
}) {
  const i18n = useI18n()
  const [search, setSearch] = useState("")
  const acted = useRef(false)
  const label = i18n.t(props.summary ? "session.summary.basedOn" : "session.new.workspace.fromBranch", {
    branch: props.branch,
  })
  const change = (value: string) => {
    setSearch(value)
    props.onSearch(value)
  }
  return (
    <DropdownMenu
      modal={!props.summary}
      onOpenChange={(open) => {
        if (open) return change("")
        if (acted.current) props.onDone?.()
        acted.current = false
      }}
    >
      <DropdownMenuTrigger
        className={
          props.summary
            ? "session-summary-row flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-accent"
            : "ms-1 flex h-6 min-w-0 max-w-[220px] items-center gap-1.5 rounded-full bg-muted px-2.5 text-[13px] text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
        }
      >
        <GitBranch aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[243px] p-0">
        <MenuSearch
          value={search}
          label={i18n.t("session.new.workspace.branch.search.placeholder")}
          onChange={change}
          focus
        />
        <div className="max-h-[224px] overflow-y-auto p-1">
          {props.branches.map((branch) => (
            <DropdownMenuItem
              key={branch}
              role="menuitemradio"
              aria-checked={branch === props.branch}
              onSelect={() => {
                acted.current = true
                props.onSelect(branch)
              }}
            >
              <span className="ui-menu__text min-w-0 truncate">{branch}</span>
              {branch === props.branch && <Check aria-hidden className="ui-menu__check" />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A search field inside a menu: typing stays in it; the arrows, Enter and Escape reach the menu. */
function MenuSearch(props: { value: string; label: string; focus?: boolean; onChange: (value: string) => void }) {
  const i18n = useI18n()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!props.focus) return
    // The menu focuses itself as it opens; take the focus back once it has.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => input.current?.focus({ preventScroll: true })),
    )
    return () => cancelAnimationFrame(frame)
  }, [props.focus])
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (["Escape", "ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) return
    event.stopPropagation()
  }
  return (
    <div className="flex h-8 items-center gap-2 border-b ps-3 pe-2 text-muted-foreground">
      <Search aria-hidden className="size-3.5 shrink-0" />
      <input
        ref={input}
        value={props.value}
        placeholder={props.label}
        aria-label={props.label}
        className="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none"
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {props.value.trim() && (
        <button
          type="button"
          aria-label={i18n.t("common.clear")}
          className="flex size-5 items-center justify-center rounded-sm hover:bg-accent"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            props.onChange("")
            input.current?.focus()
          }}
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** The branch the session would run on, or «No Git» for a plain folder. */
export function GitStatus(props: { branch?: string; noGit?: boolean; from?: boolean }) {
  const i18n = useI18n()
  const label = props.noGit
    ? i18n.t("session.new.git.none")
    : props.branch && props.from
      ? i18n.t("session.new.workspace.fromBranch", { branch: props.branch })
      : props.branch
  if (!label) return null
  const Icon = props.noGit ? Monitor : GitBranch
  return (
    <div
      title={label}
      className="ms-1 flex h-6 min-w-0 max-w-[220px] items-center gap-1.5 rounded-full bg-muted px-2.5 text-[13px] text-muted-foreground"
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  )
}
