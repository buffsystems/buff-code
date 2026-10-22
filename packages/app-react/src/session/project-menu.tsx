// The session's project menu at the start of its title row (#584), the Solid SessionProjectMenu:
// a local or worktree mark naming the project, and a menu with the project (shown on Home), its
// folder (opened in the file manager on a local desktop server), and «Edit project».

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from "@buff/ui/react"
import { isWorkspaceDirectory } from "@opencode/app/react-reuse/workspace-paths"
import { getFilename } from "@opencode/util/path"
import { ArrowUpRight, Folder, GitBranch, Monitor, Settings } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { isLocalServer } from "../core/servers"
import { setHomeSelection } from "../home/selection"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { useCore, useServerData } from "../react/core"
import { useDocumentDirection } from "../react/use-direction"
import { useNavigate } from "../router/router"
import { useSettingsSurface } from "../settings/context"
import { showToast } from "../shell/notifications/toast"
import { ProjectAvatar } from "../shell/project-avatar"
import { useSession } from "./context"
import "./project-menu.css"

export function SessionProjectMenu() {
  const i18n = useI18n()
  const core = useCore()
  const platform = usePlatform()
  const navigate = useNavigate()
  const surface = useSettingsSurface()
  const { conn, server, sessionID } = useSession()
  const dir = useDocumentDirection()
  const [open, setOpen] = useState(false)
  // The name's tooltip is a hover hint: the focus the closing menu hands back to the button does
  // not open it (the Solid trigger's tooltip stays shut then), only a fresh hover or focus does.
  const [tip, setTip] = useState({ open: false, quiet: false })
  const info = useServerData(server, (state) => state.session.info[sessionID])
  const project = useServerData(server, (state) => (info?.projectID ? state.project.info[info.projectID] : undefined))
  const directory = info?.location.directory
  if (!directory) return null
  const worktree = project?.canonical
  const name = project?.name || getFilename(worktree ?? directory)
  const workspace =
    !!project && isWorkspaceDirectory({ worktree: project.canonical, sandboxes: project.sandboxes }, directory)
  const openPath = platform.platform === "desktop" && isLocalServer(conn) ? platform.openPath : undefined

  return (
    <DropdownMenu
      modal={false}
      dir={dir}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setTip({ open: false, quiet: true })
      }}
    >
      <Tooltip
        side="bottom"
        content={<bdi>{name}</bdi>}
        open={tip.open && !tip.quiet && !open}
        onOpenChange={(next) => setTip((current) => ({ open: next, quiet: next ? current.quiet : false }))}
      >
        <DropdownMenuTrigger asChild>
          <IconButton
            icon={workspace ? GitBranch : Monitor}
            size="xs"
            aria-label={name}
            data-slot="session-project-trigger"
            className="shrink-0"
          />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" alignOffset={-8} aria-label={name} className="session-project-menu">
        <TruncatedTip text={<bdi>{name}</bdi>}>
          {(label) => (
            <DropdownMenuItem
              disabled={!worktree}
              onSelect={() => {
                if (!worktree) return
                core.serverState.projects(core.scope(server.key)).open(worktree)
                setHomeSelection(core, { server: server.key, directory: worktree })
                navigate("/")
              }}
            >
              <span className="session-project-link-content">
                <ProjectAvatar name={name} icon={project?.icon} hidden />
                <bdi ref={label} className="session-project-label">
                  {name}
                </bdi>
              </span>
            </DropdownMenuItem>
          )}
        </TruncatedTip>
        <TruncatedTip text={<bdi dir="ltr">{directory}</bdi>}>
          {(label) => (
            // A read-only path stays in keyboard navigation so its full text is reachable.
            <DropdownMenuItem
              aria-disabled={!openPath}
              className="session-project-link"
              onKeyDown={(event) => {
                // Esc closes the menu, not only the path's tooltip.
                if (event.key !== "Escape") return
                event.preventDefault()
                setOpen(false)
              }}
              onSelect={(event) => {
                if (!openPath) {
                  event.preventDefault()
                  return
                }
                void openPath(directory).catch((cause: unknown) =>
                  showToast({
                    variant: "error",
                    title: i18n.t("common.requestFailed"),
                    description: cause instanceof Error ? cause.message : i18n.t("common.requestFailed"),
                  }),
                )
              }}
            >
              <span className="session-project-link-content">
                <Folder aria-hidden data-slot="icon-svg" className="session-project-icon" />
                <bdi ref={label} dir="ltr" className="session-project-label session-project-path">
                  {directory}
                </bdi>
              </span>
              <span data-slot="session-project-open-icon" className="session-project-link-open" aria-hidden>
                <ArrowUpRight />
              </span>
            </DropdownMenuItem>
          )}
        </TruncatedTip>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!worktree}
          onSelect={() => worktree && surface.openProject({ server: server.key, project: worktree, nested: false })}
        >
          <Settings aria-hidden data-slot="icon-svg" className="session-project-icon" />
          {i18n.t("project.settings.title")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The full text above a menu row whose label is cut short, on hover and on keyboard focus. */
function TruncatedTip(props: { text: ReactNode; children: (label: (element: HTMLElement | null) => void) => ReactNode }) {
  const [label, setLabel] = useState<HTMLElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!label) return
    const measure = () => setTruncated(label.scrollWidth > label.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(label)
    return () => observer.disconnect()
  }, [label])
  return (
    <Tooltip content={props.text} open={truncated && open} onOpenChange={setOpen} className="session-project-info-tooltip">
      <div className="session-project-row">
        {props.children(setLabel)}
      </div>
    </Tooltip>
  )
}
