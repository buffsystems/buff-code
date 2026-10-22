// Where the session runs, as a menu that moves it (#584), ported from the Solid
// SessionWorkspaceMenu: the project's local repository, a new worktree, or another worktree of the
// project. The list follows the server's worktree updates and refreshes as the menu opens.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@buff/ui/react"
import { pathKey } from "@opencode/app/react-reuse/path-key"
import { containsDirectory, sameDirectory, workspaceDirectories } from "@opencode/app/react-reuse/workspace-paths"
import { getFilename } from "@opencode/util/path"
import { FolderGit2, Monitor, Plus } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { useServerData } from "../react/core"
import { showToast } from "../shell/notifications/toast"

export type WorkspaceProject = { id: string; worktree: string; sandboxes?: string[] }

export function WorkspaceMenu(props: {
  server: Server
  sessionID: string
  project: WorkspaceProject
  directory: string
  mobile?: boolean
  className?: string
  children: ReactNode
}) {
  const i18n = useI18n()
  const { server, project } = props
  const [directories, setDirectories] = useState(() => workspaceDirectories(project))
  const [selected, setSelected] = useState<string>()
  const blocked = useServerData(server, (state) => state.session.active[props.sessionID] === "running")
  const current = directories.find((workspace) => containsDirectory(workspace, props.directory))
  const others = directories.filter((workspace) => pathKey(workspace) !== pathKey(current ?? props.directory))
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl"

  const refresh = () =>
    server
      .api()
      .worktree.list({ projectID: project.id })
      .then((items) =>
        setDirectories(
          items.map((item) => item.directory).filter((directory) => !sameDirectory(project.worktree, directory)),
        ),
      )
  const latest = useRef(refresh)
  latest.current = refresh
  useEffect(
    () =>
      server.event.listen((event) => {
        if (event.type !== "worktree.updated" || event.data.projectID !== project.id) return
        void latest.current().catch(() => undefined)
      }),
    [server, project.id],
  )

  const move = async (selection: string) => {
    if (selected || blocked) return
    setSelected(selection)
    try {
      const destination = selection === "create" ? await createWorktree(server, props.directory) : selection
      await server.api().session.move({ sessionID: props.sessionID, directory: destination })
    } catch (error) {
      showToast({
        variant: "error",
        title: i18n.t("workspace.move.failed"),
        description: error instanceof Error ? error.message : i18n.t("common.requestFailed"),
      })
    } finally {
      setSelected(undefined)
    }
  }
  const disabled = !!selected || blocked

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) return
        void refresh()
          .then(() => server.api().worktree.refresh({ projectID: project.id }))
          .catch(() => undefined)
      }}
    >
      <DropdownMenuTrigger asChild disabled={blocked}>
        <button type="button" className={props.className}>
          {props.children}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={props.mobile ? "top" : rtl ? "right" : "left"}
        align={props.mobile ? "end" : "start"}
        sideOffset={4}
        collisionPadding={24}
        className="w-[200px]"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{i18n.t("workspace.move.menu.title")}</DropdownMenuLabel>
          {pathKey(props.directory) !== pathKey(project.worktree) && (
            <DropdownMenuItem disabled={disabled} onSelect={() => void move(project.worktree)}>
              <Monitor aria-hidden />
              {i18n.t("session.new.workspace.local")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={disabled} onSelect={() => void move("create")}>
            <Plus aria-hidden />
            {i18n.t("workspace.new")}
          </DropdownMenuItem>
          {others.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderGit2 aria-hidden />
                {i18n.t("session.new.workspace.existing").replace(/(…|\.{3})$/, "")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[66.667dvh] w-[200px] overflow-y-auto">
                {others.map((workspace) => (
                  <DropdownMenuItem key={workspace} disabled={disabled} onSelect={() => void move(workspace)}>
                    <FolderGit2 aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{getFilename(workspace)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A new worktree of the directory's project, known to the window before the session moves there. */
async function createWorktree(server: Server, directory: string) {
  const project =
    server.data.location.info({ directory })?.project ??
    (await server.api().location.get({ location: { directory } })).project
  const created = await server.api().worktree.create({ projectID: project.id, from: project.canonical })
  await server.data.location.syncInfo({ directory: created.directory })
  return created.directory
}
