// «Session details» of an existing session (#584), ported from the Solid SessionSummaryPanel: the
// project card — where the session runs (a menu that moves it), its branch, its changes (opening
// the review) and its background work — the suggestion to move a local session with changes to a
// worktree, then the server's extensions.

import {
  isWorkspaceDirectory,
  workspaceDirectories,
  containsDirectory,
} from "@opencode/app/react-reuse/workspace-paths"
import { getFilename } from "@opencode/util/path"
import { ChevronDown, FileDiff, FolderGit2, GitBranch, Monitor, X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import type { Server } from "../core/servers"
import { locationKey } from "../core/data/state"
import { useI18n } from "../i18n/provider"
import { useServerData } from "../react/core"
import { DiffChanges } from "../session/panes/diff-changes"
import { BackgroundWorkSummary } from "../session/timeline/background-work"
import { useSettings } from "../shell/settings-context"
import { useLiveMcp } from "../new-session/use-mcp"
import { ProjectSummaryCard } from "./project-card"
import { ServerPanel } from "./server-panel"
import { WorkspaceMenu } from "./workspace-menu"
import "./summary.css"

type Change = { additions: number; deletions: number }

export function SessionSummaryPanel(props: {
  server: Server
  sessionID: string
  /** The summary is on screen: its lists load. */
  shown: boolean
  mobile?: boolean
  sessionHref?: (sessionID: string) => string
  navigateToSession?: (sessionID: string) => void
  onReview: () => void
}) {
  const i18n = useI18n()
  const { server } = props
  const info = useServerData(server, (state) => state.session.info[props.sessionID])
  const project = useServerData(server, (state) => (info?.projectID ? state.project.info[info.projectID] : undefined))
  const directory = info?.location.directory
  const branch = useBranch(server, directory)
  const baseBranch = useBranch(server, project?.canonical)
  const diffs = useSessionDiffs(server, props.shown && !!project?.vcs ? directory : undefined)
  const projectExpanded = useSettings((settings) => settings.sessionSummary.projectExpanded)
  const [moveDismissed, setMoveDismissed] = useState(false)
  useEffect(() => setMoveDismissed(false), [props.sessionID])
  const mcp = useLiveMcp(server, directory ?? "")
  if (!project || !directory) return null

  const workspaceProject = { id: project.id, worktree: project.canonical, sandboxes: project.sandboxes }
  const local = !isWorkspaceDirectory(workspaceProject, directory)
  const workspace = workspaceDirectories(workspaceProject).find((item) => containsDirectory(item, directory))
  const location = local ? i18n.t("session.new.workspace.local") : getFilename(workspace ?? directory)
  const changes = project.vcs ? diffs : []
  const moveMenu = (children: ReactNode) => (
    <WorkspaceMenu
      server={server}
      sessionID={props.sessionID}
      project={workspaceProject}
      directory={directory}
      mobile={props.mobile}
      className="session-summary-row"
    >
      {children}
    </WorkspaceMenu>
  )

  return (
    <div data-component="session-summary-panel" data-mobile={props.mobile || undefined}>
      <div>
        <ProjectSummaryCard name={project.name || getFilename(project.canonical)}>
          {moveMenu(
            <>
              {local ? <Monitor aria-hidden /> : <FolderGit2 aria-hidden />}
              <span dir="auto" className="session-summary-label">
                {location}
              </span>
              <ChevronDown aria-hidden className="session-summary-menu-indicator" />
            </>,
          )}
          <div className="session-summary-row">
            <GitBranch aria-hidden />
            {branch ? (
              <span dir="auto" className="session-summary-label">
                {branch}
              </span>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 whitespace-nowrap">{i18n.t("session.summary.noBranch")}</span>
                {baseBranch && (
                  <>
                    <span className="session-summary-faint">·</span>
                    <span className="session-summary-faint truncate">
                      {i18n.t("session.summary.basedOn", { branch: baseBranch })}
                    </span>
                  </>
                )}
              </span>
            )}
          </div>
          <button type="button" className="session-summary-row" onClick={props.onReview}>
            <FileDiff aria-hidden />
            <ReviewLabel diffs={changes} />
          </button>
          <BackgroundWorkSummary
            server={server}
            sessionID={props.sessionID}
            sessionHref={props.sessionHref}
            navigateToSession={props.navigateToSession}
          />
        </ProjectSummaryCard>
        {projectExpanded && local && !!changes?.length && !moveDismissed && (
          <div className="session-summary-move">
            {moveMenu(
              <>
                <FolderGit2 aria-hidden />
                <span className="session-summary-label">{i18n.t("workspace.move.title")}</span>
              </>,
            )}
            <button
              type="button"
              className="session-summary-dismiss"
              aria-label={i18n.t("common.dismiss")}
              onClick={() => setMoveDismissed(true)}
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      <ServerPanel server={server} directory={directory} mcp={mcp} shown={props.shown} mobile={props.mobile} />
    </div>
  )
}

function ReviewLabel(props: { diffs?: Change[] }) {
  const i18n = useI18n()
  if (!props.diffs)
    return (
      <span className="session-summary-label session-summary-faint">{i18n.t("session.review.loadingChanges")}</span>
    )
  if (props.diffs.length === 0)
    return <span className="session-summary-label session-summary-faint">{i18n.t("session.review.noChanges")}</span>
  return (
    <span className="session-summary-label session-summary-review">
      <span className="min-w-0 truncate">{i18n.plural("ui.sessionTurn.diffs.changed", props.diffs.length)}</span>
      <span className="session-summary-faint shrink-0">·</span>
      <DiffChanges changes={props.diffs} />
    </span>
  )
}

function useBranch(server: Server, directory: string | undefined) {
  const branch = useServerData(server, (state) =>
    directory ? state.location[locationKey({ directory })]?.vcs?.branch?.current : undefined,
  )
  useEffect(() => {
    if (directory) void server.data.location.vcs.sync({ directory }).catch(() => undefined)
  }, [server, directory])
  return branch
}

/** The working changes of the session's directory while the summary shows them; undefined while loading. */
function useSessionDiffs(server: Server, directory: string | undefined) {
  const [diffs, setDiffs] = useState<{ directory: string; list: Change[] }>()
  useEffect(() => {
    if (!directory) return
    const state = { live: true }
    void server
      .api()
      .vcs.diff({ location: { directory }, mode: "working" })
      .then(
        (result) => result.data,
        () => [],
      )
      .then((list) => {
        if (state.live) setDiffs({ directory, list })
      })
    return () => {
      state.live = false
    }
  }, [server, directory])
  return diffs?.directory === directory ? diffs?.list : undefined
}
