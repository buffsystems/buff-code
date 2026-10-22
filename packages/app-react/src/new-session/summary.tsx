// «Session details» of a draft (#584): the project with where the session will run, then what
// other features add (MCP, plugins, skills, LSP) through the `summary` slot.

import { Panel } from "@buff/ui/react"
import { Folder, Monitor } from "lucide-react"
import type { ReactNode } from "react"
import { displayName } from "../home/model"
import { useI18n } from "../i18n/provider"
import { ProjectSummaryCard } from "../summary/project-card"
import type { PromptProject } from "./project-selector"

export function DraftSummary(props: {
  project?: PromptProject
  git: boolean
  workspace: ReactNode
  extensions: ReactNode
  onChooseProject: () => void
}) {
  const i18n = useI18n()
  if (!props.project)
    return (
      <div data-component="session-summary-panel" className="flex flex-col gap-2">
        <Panel className="session-summary-card p-1">
          <button
            type="button"
            className="session-summary-row flex w-full items-center gap-2 px-2 py-1.5"
            onClick={props.onChooseProject}
          >
            <Folder aria-hidden className="size-4 text-muted-foreground" />
            <span className="session-summary-label">{i18n.t("session.summary.chooseProject")}</span>
          </button>
        </Panel>
      </div>
    )
  return (
    <div data-component="session-summary-panel" className="flex flex-col gap-2">
      <ProjectSummaryCard name={displayName(props.project)}>
        {props.git ? (
          props.workspace
        ) : (
          <div className="session-summary-row flex items-center gap-2 px-2 py-1.5">
            <Monitor aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="session-summary-label">{i18n.t("session.new.git.none")}</span>
          </div>
        )}
      </ProjectSummaryCard>
      {props.extensions}
    </div>
  )
}
