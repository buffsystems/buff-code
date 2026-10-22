// The workflows page's cards (#448), ported from the Solid window's buff/workflows/cards.tsx: a
// saved workflow and a run.

import { Badge, Button, Panel } from "@buff/ui/react"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { useI18n } from "../i18n/provider"
import type { WorkflowsController } from "./controller"
import { stateTone } from "./tone"

const folder = (directory: string) => directory.split(/[\\/]/).filter(Boolean).pop() ?? directory

export function SavedCard(props: {
  saved: BuffWorkflowRpc.Saved
  onStart: () => void
  onDetail: () => void
  onRun: (id: string) => void
}) {
  const t = useI18n().buff.t
  const meta = props.saved.meta
  const last = props.saved.last
  return (
    <Panel className="buff-wf-card" data-workflow={meta.name}>
      <div className="buff-wf-head">
        <span className="buff-wf-card-title ui-title ui-title--sm">{BuffWorkflowFile.displayName(meta)}</span>
        {last && (
          <Badge size="sm" tone={stateTone(last.status)} data-state={last.status}>
            {t(BuffWorkflowFlow.STATUS_LABEL[last.status])}
          </Badge>
        )}
      </div>
      <div className="buff-wf-line">{meta.description}</div>
      {meta.whenToUse && <div className="buff-wf-line ui-note">{t("When: {text}", { text: meta.whenToUse })}</div>}
      <div className="buff-wf-line ui-note">{BuffWorkflowFlow.argsSummary(meta.args, t)}</div>
      <div className="buff-wf-actions">
        <Button size="sm" data-action="buff-wf-start" onClick={props.onStart}>
          {t("Run")}
        </Button>
        <Button size="sm" variant="ghost" data-action="buff-wf-detail" onClick={props.onDetail}>
          {t("More details")}
        </Button>
        {last && (
          <Button size="sm" variant="ghost" data-action="buff-wf-last" onClick={() => props.onRun(last.id)}>
            {t("Last run")}
          </Button>
        )}
      </div>
    </Panel>
  )
}

export function RunCard(props: {
  run: BuffWorkflow.Run
  now: number
  controller: WorkflowsController
  onOpen: () => void
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const run = props.run
  return (
    <Panel className="buff-wf-card" data-run={run.id} data-state={run.status}>
      <div className="buff-wf-head">
        <span className="buff-wf-card-title ui-title ui-title--sm">{run.label}</span>
        <Badge size="sm" tone={stateTone(run.status)} data-state={run.status}>
          {t(BuffWorkflowFlow.STATUS_LABEL[run.status])}
        </Badge>
      </div>
      <div className="buff-wf-line" data-slot="buff-wf-run-line">
        {BuffWorkflowFlow.runLine(run, props.now, t)}
      </div>
      <div className="buff-wf-line ui-note">
        {[
          run.workflow ? t("workflow «{name}»", { name: run.workflow }) : t("from the chat"),
          folder(run.directory),
          new Date(run.created).toLocaleString(i18n.locale === "ru" ? "ru-RU" : "en-US"),
          // #470: a run's number tells a person nothing — the pair to «Replaced by an amended run».
          run.resumedFrom ? t("amended run") : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <div className="buff-wf-actions">
        <Button size="sm" data-action="buff-wf-open-run" onClick={props.onOpen}>
          {t("Run progress")}
        </Button>
        {run.status === "running" && (
          <Button
            size="sm"
            variant="ghost"
            data-action="buff-wf-stop"
            onClick={() => void props.controller.stop(run.id)}
          >
            {t("Stop")}
          </Button>
        )}
        {BuffWorkflow.resumable(run) && (
          <Button
            size="sm"
            variant="ghost"
            data-action="buff-wf-resume"
            onClick={() => void props.controller.resume(run.id)}
          >
            {t("Resume")}
          </Button>
        )}
      </div>
    </Panel>
  )
}
