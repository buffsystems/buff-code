// Worktrees (#584), ported from the Solid window's settings/workspaces/workspaces.tsx: the managed
// worktrees of every project on a server (or of one project), each with its sessions; delete one
// after checking it (unmerged changes, sessions, the active one), or all of them, or those
// without sessions. The page opens at once; the inventory and the sessions fill in as they load.
// Buff (#458): a list that failed to load says so instead of «no worktrees».

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from "@buff/ui/react"
import { listNotice } from "@opencode/app/react-reuse/list-notice"
import { pathKey } from "@opencode/app/react-reuse/path-key"
import { getRelativeTime } from "@opencode/app/react-reuse/relative-time"
import { listAllSessions } from "@opencode/app/react-reuse/session-list"
import { sessionLabel } from "@opencode/app/react-reuse/session-title"
import {
  containsDirectory,
  filterWorkspaceInventory,
  inspectWorkspaceDeletion,
  managedWorkspaceDirectories,
  mergeWorkspaceSessionInventory,
  removeWorkspacesSequentially,
  sessionsForWorkspace,
  workspaceInventory,
  type WorkspaceDeleteInspection,
} from "@opencode/app/react-reuse/workspace-paths"
import type { SessionInfo } from "@opencode/client/promise"
import { getFilename } from "@opencode/util/path"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, Ellipsis, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useConnection, useServerData } from "../../react/core"
import { showToast } from "../../shell/notifications/toast"
import { useTabs } from "../../shell/tabs/provider"
import { SettingsBody, SettingsHeader, SettingsList } from "../kit"
import {
  followWorktreeUpdates,
  inventoryQuery,
  worktreeKey,
  worktreesFailed,
  type InventoryProject,
} from "../projects/inventory"
import { useSettingsScope } from "../scope"

type Workspace = { directory: string; project: InventoryProject }

export function SettingsWorkspaces(props: { projectID?: string; activeDirectory?: string; resetFilter?: number }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const scope = useSettingsScope()
  const server = scope.server
  const client = useQueryClient()
  const dialog = useDialog()
  const tabs = useTabs()
  const connected = useConnection(server).status === "connected"
  const cached = useServerData(server, (state) => state.session.info)
  const [project, setProject] = useState("all")
  const [transaction, setTransaction] = useState<"confirm" | "running">()
  const [deleting, setDeleting] = useState<string[]>([])

  useEffect(() => followWorktreeUpdates(server, client), [server, client])
  useEffect(() => setProject(props.projectID ?? "all"), [props.projectID, props.resetFilter])

  const inventory = useQuery({
    ...inventoryQuery(server, client, props.projectID),
    enabled: connected,
    refetchOnMount: true,
  })
  const projects = inventory.isPending ? [] : (inventory.data ?? [])
  const workspaces = useMemo(() => workspaceInventory(projects), [projects])
  const managed = projects.filter((item) => managedWorkspaceDirectories(item).length > 0)
  const selected = props.projectID ?? (managed.some((item) => item.id === project) ? project : "all")
  const filtered = filterWorkspaceInventory(workspaces, selected)
  const notice = listNotice({
    pending: inventory.isPending,
    failed: inventory.isError || projects.some((item) => worktreesFailed(client, server, item.id)),
    empty: filtered.length === 0,
  })
  const projectName = (item: InventoryProject) => item.name || getFilename(item.worktree)

  const directories = workspaces.map((workspace) => workspace.directory)
  const sessionQuery = useQuery({
    queryKey: [
      server.key,
      null,
      "settings-workspace-sessions",
      directories.map((directory) => String(pathKey(directory))),
    ],
    queryFn: () => loadSessions(server, directories, Object.values(cached)),
    enabled: connected && directories.length > 0,
    placeholderData: (previous) => previous,
    refetchOnMount: "always",
  })
  const sessions = mergeWorkspaceSessionInventory(
    sessionQuery.isPending ? [] : (sessionQuery.data ?? []),
    Object.values(cached),
  )
  const sessionsOf = (workspace: Workspace) => sessionsForWorkspace(sessions, workspace.directory)
  const withoutSessions =
    sessionQuery.isPending || sessionQuery.isError || sessionQuery.isPlaceholderData
      ? []
      : filtered.filter((workspace) => sessionsOf(workspace).length === 0)

  const sessionCount = (workspace: Workspace): ReactNode => {
    const count = sessionsOf(workspace).length
    if (!count && sessionQuery.isPending) return i18n.t("session.messages.loading")
    if (!count && sessionQuery.isError) return i18n.t("common.requestFailed")
    if (selected !== "all") return i18n.plural("settings.workspaces.sessions.filtered", count)
    const name = projectName(workspace.project)
    const label = i18n.plural("settings.workspaces.sessions", count, { project: name })
    const start = label.lastIndexOf(name)
    if (start < 0) return label
    return (
      <>
        {label.slice(0, start)}
        <span className="settings-workspaces-meta-project">{name}</span>
        {label.slice(start + name.length)}
      </>
    )
  }
  const relative = (time: number | undefined) =>
    time ? getRelativeTime(new Date(time).toISOString(), i18n.t) : undefined

  const inspect = async (workspace: Workspace) => {
    const location = { directory: workspace.directory }
    const [working, branch, found] = await Promise.all([
      server.api().vcs.status({ location }),
      server.api().vcs.diff({ location, mode: "branch" }),
      loadSessions(server, [workspace.directory], Object.values(cached)),
    ])
    return inspectWorkspaceDeletion({
      workspace: workspace.directory,
      activeDirectory: props.activeDirectory,
      sessions: found,
      status: working.data.length > 0 || branch.data.length > 0 ? "dirty" : "clean",
    })
  }
  const messages = (result: WorkspaceDeleteInspection) =>
    [
      result.linked ? i18n.t("settings.workspaces.delete.blocked.linked") : undefined,
      result.dirty ? i18n.t("workspace.status.dirty") : undefined,
    ].filter((message) => message !== undefined)
  const failed = (error: unknown) =>
    showToast({
      variant: "error",
      title: i18n.t("workspace.delete.failed.title"),
      description: error instanceof Error ? error.message : i18n.t("common.requestFailed"),
    })

  const remove = async (workspace: Workspace, force: boolean) => {
    const key = String(pathKey(workspace.directory))
    setDeleting((items) => [...items, key])
    try {
      if (!force) {
        const result = await inspect(workspace)
        if (result.active || result.linked || result.dirty) {
          showToast({
            variant: "error",
            title: i18n.t("workspace.delete.failed.title"),
            description: result.active ? i18n.t("settings.workspaces.delete.blocked.active") : messages(result)[0],
          })
          return
        }
      }
      const removed = await server
        .api()
        .worktree.remove({ projectID: workspace.project.id, directory: workspace.directory, force })
        .then(() => true)
        .catch((error: unknown) => {
          failed(error)
          return false
        })
      if (!removed) return
      // A draft that was in the deleted worktree goes back to its project.
      tabs.tabs().forEach((tab) => {
        if (tab.type !== "draft" || tab.server !== server.key) return
        const inside = containsDirectory(workspace.directory, tab.directory)
        const worktree = !!tab.worktree && containsDirectory(workspace.directory, tab.worktree)
        if (!inside && !worktree) return
        tabs.updateDraft(tab.draftID, {
          directory: inside ? workspace.project.worktree : tab.directory,
          worktree: undefined,
        })
      })
      await client.invalidateQueries({ queryKey: worktreeKey(server.key, workspace.project.id) })
      await client.invalidateQueries({ queryKey: [server.key, "settings-workspace-inventory"] })
    } finally {
      setDeleting((items) => items.filter((item) => item !== key))
    }
  }
  const transact = (task: () => Promise<void>) => {
    setTransaction("running")
    void task()
      .catch(failed)
      .finally(() => setTransaction(undefined))
  }
  const ask = (render: (close: () => void) => ReactNode) => {
    if (transaction) return
    setTransaction("confirm")
    dialog.show((close) =>
      render(() => {
        close()
        setTransaction((current) => (current === "confirm" ? undefined : current))
      }),
    )
  }
  const confirmDelete = (workspace: Workspace) =>
    ask((close) => (
      <DeleteWorkspaceDialog
        workspace={workspace}
        inspect={() => inspect(workspace)}
        messages={messages}
        onClose={close}
        onDelete={() => transact(() => remove(workspace, true))}
      />
    ))
  const confirmMany = (list: Workspace[], kind: "all" | "without") =>
    ask((close) => (
      <DeleteWorkspacesDialog
        title={i18n.t(kind === "all" ? "settings.workspaces.deleteAll" : "settings.workspaces.deleteWithoutSessions")}
        confirmation={i18n.plural(
          kind === "all"
            ? "settings.workspaces.deleteAll.confirm"
            : "settings.workspaces.deleteWithoutSessions.confirm",
          list.length,
        )}
        warning={i18n.t(
          kind === "all"
            ? "settings.workspaces.deleteAll.warning"
            : "settings.workspaces.deleteWithoutSessions.warning",
        )}
        onClose={close}
        onDelete={() => transact(() => removeWorkspacesSequentially(list, (workspace) => remove(workspace, false)))}
      />
    ))

  const options = [
    { id: "all", label: i18n.t("settings.workspaces.filter.all") },
    ...managed.map((item) => ({ id: item.id, label: projectName(item) })),
  ]

  return (
    <>
      <SettingsHeader
        title={i18n.t("settings.tab.workspaces")}
        description={i18n.t("settings.workspaces.description")}
      />
      <SettingsBody className="settings-workspaces">
        {filtered.length > 0 && (
          <div className="settings-workspaces-toolbar">
            <span className="settings-section-title">{i18n.plural("settings.workspaces.count", filtered.length)}</span>
            <div className="settings-workspaces-toolbar-actions">
              {!props.projectID && managed.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" trailingIcon={ChevronDown} className="max-w-48">
                      <span className="min-w-0 truncate">
                        {options.find((option) => option.id === selected)?.label}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {options.map((option) => (
                      <DropdownMenuItem key={option.id} onSelect={() => setProject(option.id)}>
                        <span className="ui-menu__text">{option.label}</span>
                        {selected === option.id && <Check aria-hidden className="ui-menu__check" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    icon={Ellipsis}
                    size="xs"
                    aria-label={i18n.t("common.moreOptions")}
                    disabled={!!transaction}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {withoutSessions.length > 0 && (
                    <>
                      <DropdownMenuItem onSelect={() => confirmMany([...withoutSessions], "without")}>
                        {i18n.t("settings.workspaces.deleteWithoutSessions")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem destructive onSelect={() => confirmMany([...filtered], "all")}>
                    {i18n.t("settings.workspaces.deleteAll")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
        <div className="settings-workspaces-inventory" data-empty={filtered.length === 0}>
          <SettingsList>
            {notice && (
              <div className="settings-workspaces-empty" data-notice={notice}>
                {notice === "loading" && i18n.t("common.loading")}
                {notice === "failed" && (
                  <>
                    <span className="settings-workspaces-empty-title">{t("Could not load the worktrees")}</span>
                    <Button size="sm" onClick={() => void inventory.refetch()}>
                      {t("Retry")}
                    </Button>
                  </>
                )}
                {notice === "empty" && (
                  <>
                    <span className="settings-workspaces-empty-title">{i18n.t("settings.workspaces.empty")}</span>
                    <span>{i18n.t("settings.workspaces.empty.description")}</span>
                  </>
                )}
              </div>
            )}
            {filtered.map((workspace) => {
              const linked = sessionsOf(workspace)
              const busy = deleting.includes(String(pathKey(workspace.directory)))
              const active = relative(linked[0]?.time.updated)
              return (
                <div
                  key={`${workspace.project.id}:${pathKey(workspace.directory)}`}
                  className="settings-workspaces-row"
                >
                  <div className="settings-workspaces-row-header">
                    <div className="settings-workspaces-copy">
                      <WorkspacePath directory={workspace.directory} />
                      <span className="settings-workspaces-meta">{sessionCount(workspace)}</span>
                    </div>
                    <div className="settings-workspaces-row-actions">
                      {busy && (
                        <span className="settings-workspaces-active">{i18n.t("workspace.lifecycle.deleting")}</span>
                      )}
                      {!busy && active && (
                        <Tooltip content={i18n.t("settings.workspaces.lastActiveSession")}>
                          <span tabIndex={0} className="settings-workspaces-active">
                            {active}
                          </span>
                        </Tooltip>
                      )}
                      {!busy && (
                        <IconButton
                          icon={Trash2}
                          size="xs"
                          aria-label={i18n.t("workspace.delete.confirm", { name: getFilename(workspace.directory) })}
                          disabled={!!transaction}
                          onClick={() => confirmDelete(workspace)}
                        />
                      )}
                    </div>
                  </div>
                  {linked.length > 0 && (
                    <div className="settings-workspaces-sessions">
                      {linked.map((session) => (
                        <div key={session.id} className="settings-workspaces-session">
                          <span>{sessionLabel(session, t)}</span>
                          {linked.length > 1 && relative(session.time.updated) && (
                            <span className="settings-workspaces-session-time">{relative(session.time.updated)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </SettingsList>
        </div>
      </SettingsBody>
    </>
  )
}

// Sessions per worktree directory rather than paging through every session of the server.
async function loadSessions(server: Server, directories: readonly string[], cached: readonly SessionInfo[]) {
  const fetched = await Promise.all(
    directories.map((directory) => listAllSessions(server.api().session, { order: "desc", directory })),
  )
  return mergeWorkspaceSessionInventory(fetched.flat(), cached)
}

function WorkspacePath(props: { directory: string }) {
  const name = getFilename(props.directory)
  const element = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)
  useEffect(() => {
    const span = element.current
    if (!span) return
    const observer = new ResizeObserver(() => setTruncated(span.scrollWidth > span.clientWidth))
    observer.observe(span)
    return () => observer.disconnect()
  }, [])
  const path = (
    <span
      ref={element}
      tabIndex={truncated ? 0 : undefined}
      dir="ltr"
      aria-label={props.directory}
      className="settings-workspaces-path"
    >
      <span>{props.directory.slice(0, -name.length)}</span>
      <span className="settings-workspaces-path-name">{name}</span>
    </span>
  )
  if (!truncated) return <div className="settings-workspaces-main">{path}</div>
  return (
    <div className="settings-workspaces-main">
      <Tooltip content={props.directory}>{path}</Tooltip>
    </div>
  )
}

function DeleteWorkspaceDialog(props: {
  workspace: Workspace
  inspect: () => Promise<WorkspaceDeleteInspection>
  messages: (result: WorkspaceDeleteInspection) => string[]
  onClose: () => void
  onDelete: () => void
}) {
  const i18n = useI18n()
  const [id] = useState(() => crypto.randomUUID())
  const status = useQuery({
    queryKey: ["workspace-delete-status", props.workspace.directory, id],
    queryFn: props.inspect,
    staleTime: 0,
    retry: false,
  })
  const notes = status.isError ? [i18n.t("workspace.status.error")] : status.data ? props.messages(status.data) : []
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={i18n.t("workspace.delete.confirm", { name: getFilename(props.workspace.directory) })}
      closeLabel={i18n.t("common.close")}
    >
      <DialogBody>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <span className="ui-hint">
              {i18n.t(status.isPending ? "workspace.status.checking" : "workspace.delete.location")}
            </span>
            <code className="ui-code w-fit max-w-full break-all">{props.workspace.directory}</code>
          </div>
          <p className="ui-note">{i18n.t("settings.workspaces.delete.warning")}</p>
          {notes.map((note) => (
            <p key={note} className="ui-note">
              {note}
            </p>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={props.onClose}>{i18n.t("common.cancel")}</Button>
        <Button
          variant="destructive"
          disabled={status.isPending || status.isError}
          onClick={() => {
            props.onDelete()
            props.onClose()
          }}
        >
          {i18n.t("workspace.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function DeleteWorkspacesDialog(props: {
  title: string
  confirmation: string
  warning: string
  onClose: () => void
  onDelete: () => void
}) {
  const i18n = useI18n()
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={props.title}
      description={
        <span className="flex flex-col gap-2">
          <span>{props.confirmation}</span>
          <span>{props.warning}</span>
        </span>
      }
      closeLabel={i18n.t("common.close")}
    >
      <DialogFooter>
        <Button onClick={props.onClose}>{i18n.t("common.cancel")}</Button>
        <Button
          variant="destructive"
          onClick={() => {
            props.onDelete()
            props.onClose()
          }}
        >
          {i18n.t("settings.workspaces.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
