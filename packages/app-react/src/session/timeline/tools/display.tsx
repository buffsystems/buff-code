// One tool call in the timeline (#584): the renderer registered for its name, or the error card
// when it failed — the Solid ToolDisplay and ToolRegistry.

import { BuffPlan } from "@opencode/schema/buff-plan"
import { BuffTodo } from "@opencode/schema/buff-todo"
import { formAbortNote } from "@opencode/session-ui/timeline/buff-form-abort"
import type { ComponentType } from "react"
import "./tools.css"
import { useI18n } from "../../../i18n/provider"
import { useTimeline } from "../context"
import { ToolErrorCard } from "./common"
import { EditTool, PatchTool, WriteTool } from "./file-tools"
import { buffToolTitle, toolDisplayError, toolErrorSubtitle, webSearchProviderLabel } from "./info"
import { useSessionDirectory } from "./session"
import { ExecuteTool, ShellTool, SubagentTool } from "./shell-tools"
import {
  GenericTool,
  GlobTool,
  GrepTool,
  ListTool,
  PlanTool,
  QuestionTool,
  ReadTool,
  SkillTool,
  TodoTool,
  WebfetchTool,
  WebsearchTool,
} from "./simple-tools"
import type { ToolProps } from "./types"

const registry: Record<string, ComponentType<ToolProps>> = {
  read: ReadTool,
  list: ListTool,
  glob: GlobTool,
  grep: GrepTool,
  webfetch: WebfetchTool,
  websearch: WebsearchTool,
  subagent: SubagentTool,
  execute: ExecuteTool,
  shell: ShellTool,
  edit: EditTool,
  write: WriteTool,
  patch: PatchTool,
  question: QuestionTool,
  skill: SkillTool,
  [BuffTodo.TOOL]: TodoTool,
  [BuffPlan.TOOL]: PlanTool,
}

export function toolRenderer(name: string) {
  return registry[name] ?? GenericTool
}

export function ToolDisplay(props: ToolProps & { id: string; error?: string }) {
  const i18n = useI18n()
  const timeline = useTimeline()
  const directory = useSessionDirectory()
  if (props.tool === "todowrite") return null
  if (props.tool === "question" && (props.status === "streaming" || props.status === "running")) return null
  const taskID =
    props.tool === "subagent" && typeof props.metadata.sessionID === "string" && props.metadata.sessionID
      ? props.metadata.sessionID
      : undefined
  const taskSubtitle =
    props.tool === "subagent"
      ? typeof props.input.description === "string" && props.input.description
        ? props.input.description
        : taskID
      : undefined
  const error = toolDisplayError(props, i18n.t("ui.toolErrorCard.failed"))
  const Render = toolRenderer(props.tool)
  // Buff (#470): a question or plan left unanswered is a quiet line, also when Buff Code closed
  // while the form waited — not an English failure card.
  const note = error ? formAbortNote(props.tool, error) : undefined
  return (
    <div data-component="tool-part-wrapper" data-timeline-part-id={props.id}>
      {note ? (
        <div className="tool-note">
          <span className="tool-note__text">{i18n.buff.t(note)}</span>
        </div>
      ) : error ? (
        <ToolErrorCard
          tool={props.tool}
          error={error}
          title={
            props.tool === "websearch"
              ? webSearchProviderLabel(props.metadata.provider, i18n)
              : buffToolTitle(props.tool, i18n.locale)
          }
          defaultOpen={props.defaultOpen}
          open={props.open}
          onOpenChange={props.onOpenChange}
          subtitle={taskSubtitle ?? toolErrorSubtitle(props, i18n, directory)}
          href={taskID ? timeline.actions.sessionHref?.(taskID) : undefined}
          onSubtitleClick={(event) => {
            const navigate = timeline.actions.navigateToSession
            if (!navigate || !taskID) return
            if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            event.preventDefault()
            navigate(taskID)
          }}
        />
      ) : (
        <Render {...props} />
      )}
    </div>
  )
}
