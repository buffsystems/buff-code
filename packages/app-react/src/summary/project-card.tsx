// The project's card in «Session details» (#584), the Solid ProjectSummaryCard: a heading naming
// the project that folds the card's rows away, remembered across sessions in the settings.

import { ChevronDown } from "lucide-react"
import { useId, type ReactNode } from "react"
import { ProjectAvatar } from "../shell/project-avatar"
import { useSettings, useSettingsModel } from "../shell/settings-context"
import "./summary.css"

export function ProjectSummaryCard(props: { name: string; children: ReactNode }) {
  const model = useSettingsModel()
  const expanded = useSettings((settings) => settings.sessionSummary.projectExpanded)
  const content = useId()
  return (
    <section data-section="project" className="session-summary-card">
      <button
        type="button"
        className="session-summary-row session-summary-heading"
        aria-label={props.name}
        aria-expanded={expanded}
        aria-controls={content}
        onClick={() => model.sessionSummary({ projectExpanded: !expanded })}
      >
        <ProjectAvatar name={props.name} />
        <span dir="auto" className="session-summary-label">
          {props.name}
        </span>
        <ChevronDown aria-hidden className="session-summary-disclosure" size={14} />
      </button>
      {expanded && (
        <div id={content} className="session-summary-rows">
          {props.children}
        </div>
      )}
    </section>
  )
}
