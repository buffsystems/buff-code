import { Show } from "solid-js"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { Button } from "@opencode/ui/button"
import { useBuffText } from "../i18n"
import type { WorkflowsController } from "./controller"

/** Карточки страницы сценариев (#448): сохранённый сценарий и прогон. */

const folder = (directory: string) => directory.split(/[\\/]/).filter(Boolean).pop() ?? directory

export function SavedCard(props: {
  saved: BuffWorkflowRpc.Saved
  onStart: () => void
  onDetail: () => void
  onRun: (id: string) => void
}) {
  const meta = () => props.saved.meta
  const { t } = useBuffText()
  return (
    <article class="buff-wf-card" data-workflow={meta().name}>
      <div class="buff-wf-card-head">
        <span class="buff-wf-card-title">{BuffWorkflowFile.displayName(meta())}</span>
        <Show when={props.saved.last}>
          {(last) => (
            <span class="buff-wf-badge" data-state={last().status}>
              {t(BuffWorkflowFlow.STATUS_LABEL[last().status])}
            </span>
          )}
        </Show>
      </div>
      <div class="buff-wf-card-line">{meta().description}</div>
      <Show when={meta().whenToUse}>
        <div class="buff-wf-card-line buff-wf-weak">{t("When: {text}", { text: meta().whenToUse ?? "" })}</div>
      </Show>
      <div class="buff-wf-card-line buff-wf-weak">{BuffWorkflowFlow.argsSummary(meta().args, t)}</div>
      <div class="buff-wf-actions">
        <Button size="small" variant="neutral" data-action="buff-wf-start" onClick={props.onStart}>
          {t("Run")}
        </Button>
        <Button size="small" variant="ghost" data-action="buff-wf-detail" onClick={props.onDetail}>
          {t("More details")}
        </Button>
        <Show when={props.saved.last}>
          {(last) => (
            <Button size="small" variant="ghost" data-action="buff-wf-last" onClick={() => props.onRun(last().id)}>
              {t("Last run")}
            </Button>
          )}
        </Show>
      </div>
    </article>
  )
}

export function RunCard(props: {
  run: BuffWorkflow.Run
  now: number
  controller: WorkflowsController
  onOpen: () => void
}) {
  const { t, locale } = useBuffText()
  return (
    <article class="buff-wf-card" data-run={props.run.id} data-state={props.run.status}>
      <div class="buff-wf-card-head">
        <span class="buff-wf-card-title">{props.run.label}</span>
        <span class="buff-wf-badge" data-state={props.run.status}>
          {t(BuffWorkflowFlow.STATUS_LABEL[props.run.status])}
        </span>
      </div>
      <div class="buff-wf-card-line" data-slot="buff-wf-run-line">
        {BuffWorkflowFlow.runLine(props.run, props.now, t)}
      </div>
      <div class="buff-wf-card-line buff-wf-weak">
        {[
          props.run.workflow ? t("workflow «{name}»", { name: props.run.workflow }) : t("from the chat"),
          folder(props.run.directory),
          new Date(props.run.created).toLocaleString(locale() === "ru" ? "ru-RU" : "en-US"),
          // #470: номер прогона человеку ничего не говорит — пара к «Заменён исправленным прогоном».
          props.run.resumedFrom ? t("amended run") : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <div class="buff-wf-actions">
        <Button size="small" variant="neutral" data-action="buff-wf-open-run" onClick={props.onOpen}>
          {t("Run progress")}
        </Button>
        <Show when={props.run.status === "running"}>
          <Button
            size="small"
            variant="ghost"
            data-action="buff-wf-stop"
            onClick={() => void props.controller.stop(props.run.id)}
          >
            {t("Stop")}
          </Button>
        </Show>
        <Show when={BuffWorkflow.resumable(props.run)}>
          <Button
            size="small"
            variant="ghost"
            data-action="buff-wf-resume"
            onClick={() => void props.controller.resume(props.run.id)}
          >
            {t("Resume")}
          </Button>
        </Show>
      </div>
    </article>
  )
}
