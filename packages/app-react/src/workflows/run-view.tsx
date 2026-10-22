// A workflow run (#448), ported from the Solid window's buff/workflows/run-view.tsx: the state, time
// and metrics, the phases with their subagent steps (assigned, result, failure, metrics), subagent
// questions with an answer, artifacts and panels, the result and the log. While the run goes it
// refreshes itself. Stop, resume, open the session, fix in the chat.

import { Badge, Button, Dialog, DialogBody, Field, Panel, Spinner, Textarea } from "@buff/ui/react"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState, type ReactNode } from "react"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import type { WorkflowsController } from "./controller"
import { ArtifactCard } from "./panels"
import { stateTone } from "./tone"

const LIVE_MS = 2_000
const json = (value: unknown) => JSON.stringify(value, null, 2)

export function RunView(props: {
  id: string
  server: Server
  controller: WorkflowsController
  onClose: () => void
  onOpenSession: (session: string) => void
  onFixInChat: (run: BuffWorkflow.Run) => void
}) {
  const t = useI18n().buff.t
  const detail = useQuery({
    queryKey: ["buff-workflow-run", props.server.key, props.id],
    queryFn: () => props.controller.detail(props.id),
    gcTime: 0,
  })
  const [now, setNow] = useState(Date.now())
  const running = detail.data?.run.status === "running"
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
      if (running) void detail.refetch()
    }, LIVE_MS)
    return () => clearInterval(timer)
  }, [running])
  const act = (call: Promise<unknown>) => void call.then(() => detail.refetch())
  const leave = (then: () => void) => {
    props.onClose()
    then()
  }
  const value = detail.data
  const run = value?.run

  return (
    <Dialog
      open
      size="xl"
      onOpenChange={(open) => !open && props.onClose()}
      title={run?.label ?? t("Workflow run")}
      closeLabel={t("Close")}
    >
      <DialogBody>
        {!value || !run ? (
          <span className="ui-note flex items-center gap-2">
            <Spinner />
            {t("Loading the run…")}
          </span>
        ) : (
          <Body
            detail={value}
            now={now}
            controller={props.controller}
            onAnswered={() => void detail.refetch()}
            onOpenSession={(session) => leave(() => props.onOpenSession(session))}
            actions={
              <div className="buff-wf-actions">
                {run.status === "running" && (
                  <Button size="sm" data-action="buff-wf-stop" onClick={() => act(props.controller.stop(run.id))}>
                    {t("Stop")}
                  </Button>
                )}
                {BuffWorkflow.resumable(run) && (
                  <Button size="sm" data-action="buff-wf-resume" onClick={() => act(props.controller.resume(run.id))}>
                    {t("Resume")}
                  </Button>
                )}
                {run.session && (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-action="buff-wf-open-session"
                    onClick={() => run.session && leave(() => props.onOpenSession(run.session ?? ""))}
                  >
                    {t("Open session")}
                  </Button>
                )}
                {!run.supersededBy && (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-action="buff-wf-fix-run"
                    onClick={() => leave(() => props.onFixInChat(run))}
                  >
                    {t("Fix in chat")}
                  </Button>
                )}
              </div>
            }
          />
        )}
      </DialogBody>
    </Dialog>
  )
}

function Body(props: {
  detail: BuffWorkflowRpc.Detail
  now: number
  controller: WorkflowsController
  actions: ReactNode
  onAnswered: () => void
  onOpenSession: (session: string) => void
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const run = props.detail.run
  const approvals = props.detail.steps.filter((step) => step.status === "approval")
  const phases = BuffWorkflow.phases(run.phases, props.detail.steps)
  const waiting = props.detail.questions.filter((question) => question.answer === undefined)
  const time = (at: number) => new Date(at).toLocaleTimeString(i18n.locale === "ru" ? "ru-RU" : "en-US")
  const shown = props.detail.artifacts.toSorted((a, b) => Number(!!b.primary) - Number(!!a.primary))
  const reported = props.detail.items.filter((item) => !item.artifact)
  const session = run.session
  return (
    <div className="buff-wf-run" data-component="buff-workflow-run" data-status={run.status}>
      <div className="buff-wf-head">
        <Badge tone={stateTone(run.status)} data-state={run.status}>
          {BuffWorkflow.runLabel(run, t)}
        </Badge>
        <span className="ui-note">{BuffWorkflowFlow.progress(phases, run.status, t)}</span>
      </div>
      <div className="buff-wf-metrics ui-num" data-slot="buff-wf-metrics">
        <span>{t("Time: {elapsed}", { elapsed: BuffWorkflow.elapsed(run, props.now, t) })}</span>
        <span>
          {t("Tokens: {total} (input {input}, output {output}, cache {cache})", {
            total: BuffWorkflow.tokens(run.metrics.tokens.total, t),
            input: BuffWorkflow.tokens(run.metrics.tokens.input, t),
            output: BuffWorkflow.tokens(run.metrics.tokens.output, t),
            cache: BuffWorkflow.tokens(run.metrics.tokens.cache, t),
          })}
        </span>
        <span>
          {t("Files: +{added} ~{modified} −{deleted} · lines +{linesAdded} −{linesDeleted}", {
            added: run.metrics.files.added,
            modified: run.metrics.files.modified,
            deleted: run.metrics.files.deleted,
            linesAdded: run.metrics.lines.added,
            linesDeleted: run.metrics.lines.deleted,
          })}
        </span>
      </div>
      {props.actions}
      {approvals.length > 0 && session && (
        <Section title={t("Steps waiting for permission")} slot="buff-wf-approvals">
          {approvals.map((step) => (
            <Panel tone="info" key={step.id} className="buff-wf-question" data-approval={step.id}>
              <span>
                {t("{actor} is waiting for your permission — answer in the workflow session.", { actor: step.actor })}
              </span>
              <div className="buff-wf-actions">
                <Button
                  size="sm"
                  variant="primary"
                  data-action="buff-wf-approve"
                  onClick={() => props.onOpenSession(session)}
                >
                  {t("Answer in the session")}
                </Button>
              </div>
            </Panel>
          ))}
        </Section>
      )}
      {waiting.length > 0 && (
        <Section title={t("Subagent questions")} slot="buff-wf-questions">
          {waiting.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              controller={props.controller}
              onAnswered={props.onAnswered}
            />
          ))}
        </Section>
      )}
      <Section title={t("Phases")}>
        {!phases.length && <span className="ui-hint">{t("No steps yet.")}</span>}
        {phases.map((phase, index) => (
          <Panel key={`${phase.name}-${index}`} className="buff-wf-phase" data-status={phase.status}>
            <div className="buff-wf-head">
              <span className="ui-title ui-title--sm">
                {phase.name === BuffWorkflow.NO_PHASE ? t(phase.name) : `${index + 1}. ${phase.name}`}
              </span>
              <Badge size="sm" tone={stateTone(phase.status)} data-state={phase.status}>
                {t(BuffWorkflowFlow.PHASE_LABEL[phase.status])}
              </Badge>
              <span className="ui-hint">{BuffWorkflow.metricsText(phase.metrics, t)}</span>
            </div>
            {phase.steps.map((step) => (
              <StepRow key={step.id} step={step} now={props.now} />
            ))}
          </Panel>
        ))}
      </Section>
      {shown.length > 0 && (
        <Section title={t("Artifacts")}>
          {shown.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} items={props.detail.items} />
          ))}
        </Section>
      )}
      {reported.length > 0 && (
        <Section title={t("Reported along the way")}>
          {reported.map((item, index) => (
            <pre key={index} className="ui-code-block">
              {json(item.value)}
            </pre>
          ))}
        </Section>
      )}
      {run.result !== undefined && (
        <Section title={t("Result")}>
          <pre className="ui-code-block" data-slot="buff-wf-result">
            {json(run.result)}
          </pre>
        </Section>
      )}
      {props.detail.log.length > 0 && (
        <Section title={t("Log")}>
          <div className="buff-wf-log">
            {props.detail.log.map((line, index) => (
              <div key={index}>
                <span className="ui-hint ui-num">{time(line.at)}</span> {t(line.text)}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section(props: { title: string; slot?: string; children?: ReactNode }) {
  return (
    <section className="buff-wf-section" data-slot={props.slot}>
      <h3 className="ui-title ui-title--sm">{props.title}</h3>
      {props.children}
    </section>
  )
}

function StepRow(props: { step: BuffWorkflow.Step; now: number }) {
  const t = useI18n().buff.t
  const step = props.step
  return (
    <details className="buff-wf-step" data-status={step.status}>
      <summary className="buff-wf-step-head">
        <span className="font-medium">{step.actor}</span>
        <Badge size="sm" tone={stateTone(step.status)} data-state={step.status}>
          {t(BuffWorkflowFlow.STEP_LABEL[step.status])}
        </Badge>
        <span className="ui-hint">
          {BuffWorkflow.stepElapsed(step, props.now, t)} · {BuffWorkflow.metricsText(step.metrics, t)}
        </span>
      </summary>
      <div className="buff-wf-step-body">
        <span className="ui-eyebrow">{t("Assigned")}</span>
        <pre className="ui-code-block">{step.instructions}</pre>
        {step.error && (
          <span className="ui-error" role="alert">
            {t(step.error)}
          </span>
        )}
        {step.result !== undefined && (
          <>
            <span className="ui-eyebrow">{t("Step result")}</span>
            <pre className="ui-code-block">{json(step.result)}</pre>
          </>
        )}
      </div>
    </details>
  )
}

function QuestionCard(props: {
  question: BuffWorkflow.Question
  controller: WorkflowsController
  onAnswered: () => void
}) {
  const t = useI18n().buff.t
  const [text, setText] = useState("")
  const [problem, setProblem] = useState<string>()
  const send = async () => {
    if (!text.trim()) return setProblem(t("Write an answer."))
    const refusal = await props.controller.answer(props.question.id, text.trim())
    if (refusal) return setProblem(refusal)
    props.onAnswered()
  }
  return (
    <Panel tone="info" className="buff-wf-question" data-question={props.question.id}>
      <span className="ui-title ui-title--sm">{t("{actor} asks", { actor: props.question.actor })}</span>
      <p>{props.question.text}</p>
      <Field label={t("Answer")} error={problem}>
        <Textarea rows={3} value={text} onChange={(event) => setText(event.currentTarget.value)} />
      </Field>
      <div className="buff-wf-actions">
        <Button size="sm" variant="primary" data-action="buff-wf-answer" onClick={() => void send()}>
          {t("Reply")}
        </Button>
      </div>
    </Panel>
  )
}
