import { createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { TextField } from "@opencode/ui/text-field"
import { MarkdownProvider } from "@opencode/session-ui/context/markdown"
import { useServerSDK } from "@/runtime/server/client"
import { readLocalImage } from "@/runtime/server/image"
import { useBuffText } from "../i18n"
import { Problem } from "../settings-kit"
import type { WorkflowsController } from "./controller"
import { ArtifactCard } from "./panels"

/**
 * Прогон сценария (#448): состояние, время и метрики, фазы с шагами субагентов (что поручено,
 * итог, сбой, метрики), вопросы субагентов с ответом, артефакты и панели, итог и журнал. Пока
 * прогон идёт — обновляется сам. Остановить, продолжить, открыть сессию, исправить в чате.
 */

const LIVE_MS = 2_000
const json = (value: unknown) => JSON.stringify(value, null, 2)

export function RunView(props: {
  id: string
  controller: WorkflowsController
  onOpenSession: (session: string) => void
  onFixInChat: (run: BuffWorkflow.Run) => void
  onOpenFile?: (path: string) => void
}) {
  const dialog = useDialog()
  const sdk = useServerSDK()
  const { t } = useBuffText()
  const [detail, { refetch }] = createResource(() => props.controller.detail(props.id))
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
      if (detail()?.run.status === "running") void refetch()
    }, LIVE_MS)
    onCleanup(() => clearInterval(timer))
  })
  const act = (call: Promise<unknown>) => void call.then(() => refetch())

  return (
    <Dialog size="x-large">
      <DialogHeader>
        <DialogTitle>{detail()?.run.label ?? t("Workflow run")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Show when={detail()} fallback={<span class="buff-wf-weak">{t("Loading the run…")}</span>}>
          {(value) => (
            <MarkdownProvider
              readImage={(path, signal) => readLocalImage(sdk.api, value().run.directory, path, signal)}
            >
              <Body
                detail={value()}
                now={now()}
                controller={props.controller}
                onAnswered={() => void refetch()}
                onOpenSession={(session) => {
                  dialog.close()
                  props.onOpenSession(session)
                }}
                onOpenFile={props.onOpenFile}
                actions={
                  <div class="buff-wf-actions">
                    <Show when={value().run.status === "running"}>
                      <Button
                        size="small"
                        variant="neutral"
                        data-action="buff-wf-stop"
                        onClick={() => act(props.controller.stop(value().run.id))}
                      >
                        {t("Stop")}
                      </Button>
                    </Show>
                    <Show when={BuffWorkflow.resumable(value().run)}>
                      <Button
                        size="small"
                        variant="neutral"
                        data-action="buff-wf-resume"
                        onClick={() => act(props.controller.resume(value().run.id))}
                      >
                        {t("Resume")}
                      </Button>
                    </Show>
                    <Show when={value().run.session}>
                      {(session) => (
                        <Button
                          size="small"
                          variant="ghost"
                          data-action="buff-wf-open-session"
                          onClick={() => {
                            dialog.close()
                            props.onOpenSession(session())
                          }}
                        >
                          {t("Open session")}
                        </Button>
                      )}
                    </Show>
                    <Show when={!value().run.supersededBy}>
                      <Button
                        size="small"
                        variant="ghost"
                        data-action="buff-wf-fix-run"
                        onClick={() => {
                          dialog.close()
                          props.onFixInChat(value().run)
                        }}
                      >
                        {t("Fix in chat")}
                      </Button>
                    </Show>
                  </div>
                }
              />
            </MarkdownProvider>
          )}
        </Show>
      </DialogBody>
    </Dialog>
  )
}

function Body(props: {
  detail: BuffWorkflowRpc.Detail
  now: number
  controller: WorkflowsController
  actions: JSX.Element
  onAnswered: () => void
  onOpenSession: (session: string) => void
  onOpenFile?: (path: string) => void
}) {
  const { t, locale } = useBuffText()
  const run = () => props.detail.run
  const approvals = () => props.detail.steps.filter((step) => step.status === "approval")
  const phases = () => BuffWorkflow.phases(run().phases, props.detail.steps)
  const waiting = () => props.detail.questions.filter((question) => question.answer === undefined)
  const time = (at: number) => new Date(at).toLocaleTimeString(locale() === "ru" ? "ru-RU" : "en-US")
  const shown = () => props.detail.artifacts.toSorted((a, b) => Number(!!b.primary) - Number(!!a.primary))
  return (
    <div class="buff-wf-run" data-component="buff-workflow-run" data-status={run().status}>
      <div class="buff-wf-run-head">
        <span class="buff-wf-badge" data-state={run().status}>
          {BuffWorkflow.runLabel(run(), t)}
        </span>
        <span class="buff-wf-weak">{BuffWorkflowFlow.progress(phases(), run().status, t)}</span>
      </div>
      <div class="buff-wf-metrics" data-slot="buff-wf-metrics">
        <span>{t("Time: {elapsed}", { elapsed: BuffWorkflow.elapsed(run(), props.now, t) })}</span>
        <span>
          {t("Tokens: {total} (input {input}, output {output}, cache {cache})", {
            total: BuffWorkflow.tokens(run().metrics.tokens.total, t),
            input: BuffWorkflow.tokens(run().metrics.tokens.input, t),
            output: BuffWorkflow.tokens(run().metrics.tokens.output, t),
            cache: BuffWorkflow.tokens(run().metrics.tokens.cache, t),
          })}
        </span>
        <span>
          {t("Files: +{added} ~{modified} −{deleted} · lines +{linesAdded} −{linesDeleted}", {
            added: run().metrics.files.added,
            modified: run().metrics.files.modified,
            deleted: run().metrics.files.deleted,
            linesAdded: run().metrics.lines.added,
            linesDeleted: run().metrics.lines.deleted,
          })}
        </span>
      </div>
      {props.actions}
      <Show when={approvals().length ? run().session : undefined}>
        {(session) => (
          <section class="buff-wf-section" data-slot="buff-wf-approvals">
            <h3 class="buff-wf-section-title">{t("Steps waiting for permission")}</h3>
            <For each={approvals()}>
              {(step) => (
                <div class="buff-wf-question" data-approval={step.id}>
                  <span>
                    {t("{actor} is waiting for your permission — answer in the workflow session.", {
                      actor: step.actor,
                    })}
                  </span>
                  <div class="buff-wf-actions">
                    <Button
                      size="small"
                      variant="contrast"
                      data-action="buff-wf-approve"
                      onClick={() => props.onOpenSession(session())}
                    >
                      {t("Answer in the session")}
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </section>
        )}
      </Show>
      <Show when={waiting().length}>
        <section class="buff-wf-section" data-slot="buff-wf-questions">
          <h3 class="buff-wf-section-title">{t("Subagent questions")}</h3>
          <For each={waiting()}>
            {(question) => (
              <QuestionCard question={question} controller={props.controller} onAnswered={props.onAnswered} />
            )}
          </For>
        </section>
      </Show>
      <section class="buff-wf-section">
        <h3 class="buff-wf-section-title">{t("Phases")}</h3>
        <Show when={phases().length} fallback={<span class="buff-wf-weak">{t("No steps yet.")}</span>}>
          <For each={phases()}>
            {(phase, index) => (
              <div class="buff-wf-phase" data-status={phase.status}>
                <div class="buff-wf-phase-head">
                  <span class="buff-wf-phase-name">
                    {phase.name === BuffWorkflow.NO_PHASE ? t(phase.name) : `${index() + 1}. ${phase.name}`}
                  </span>
                  <span class="buff-wf-badge" data-state={phase.status}>
                    {t(BuffWorkflowFlow.PHASE_LABEL[phase.status])}
                  </span>
                  <span class="buff-wf-weak">{BuffWorkflow.metricsText(phase.metrics, t)}</span>
                </div>
                <For each={phase.steps}>{(step) => <StepRow step={step} now={props.now} />}</For>
              </div>
            )}
          </For>
        </Show>
      </section>
      <Show when={shown().length}>
        <section class="buff-wf-section">
          <h3 class="buff-wf-section-title">{t("Artifacts")}</h3>
          <For each={shown()}>
            {(artifact) => (
              <ArtifactCard artifact={artifact} items={props.detail.items} onOpenFile={props.onOpenFile} />
            )}
          </For>
        </section>
      </Show>
      <Show when={props.detail.items.some((item) => !item.artifact)}>
        <section class="buff-wf-section">
          <h3 class="buff-wf-section-title">{t("Reported along the way")}</h3>
          <For each={props.detail.items.filter((item) => !item.artifact)}>
            {(item) => <pre class="buff-wf-pre">{json(item.value)}</pre>}
          </For>
        </section>
      </Show>
      <Show when={run().result !== undefined}>
        <section class="buff-wf-section">
          <h3 class="buff-wf-section-title">{t("Result")}</h3>
          <pre class="buff-wf-pre" data-slot="buff-wf-result">
            {json(run().result)}
          </pre>
        </section>
      </Show>
      <Show when={props.detail.log.length}>
        <section class="buff-wf-section">
          <h3 class="buff-wf-section-title">{t("Log")}</h3>
          <div class="buff-wf-log">
            <For each={props.detail.log}>
              {(line) => (
                <div>
                  <span class="buff-wf-weak">{time(line.at)}</span> {t(line.text)}
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>
    </div>
  )
}

function StepRow(props: { step: BuffWorkflow.Step; now: number }) {
  const { t } = useBuffText()
  return (
    <details class="buff-wf-step" data-status={props.step.status}>
      <summary class="buff-wf-step-head">
        <span class="buff-wf-step-actor">{props.step.actor}</span>
        <span class="buff-wf-badge" data-state={props.step.status}>
          {t(BuffWorkflowFlow.STEP_LABEL[props.step.status])}
        </span>
        <span class="buff-wf-weak">
          {BuffWorkflow.stepElapsed(props.step, props.now, t)} · {BuffWorkflow.metricsText(props.step.metrics, t)}
        </span>
      </summary>
      <div class="buff-wf-step-body">
        <span class="buff-wf-label">{t("Assigned")}</span>
        <pre class="buff-wf-pre">{props.step.instructions}</pre>
        <Show when={props.step.error}>
          <Problem text={props.step.error && t(props.step.error)} />
        </Show>
        <Show when={props.step.result !== undefined}>
          <span class="buff-wf-label">{t("Step result")}</span>
          <pre class="buff-wf-pre">{json(props.step.result)}</pre>
        </Show>
      </div>
    </details>
  )
}

function QuestionCard(props: {
  question: BuffWorkflow.Question
  controller: WorkflowsController
  onAnswered: () => void
}) {
  const { t } = useBuffText()
  const [text, setText] = createSignal("")
  const [problem, setProblem] = createSignal<string>()
  const send = async () => {
    if (!text().trim()) return setProblem(t("Write an answer."))
    const refusal = await props.controller.answer(props.question.id, text().trim())
    if (refusal) return setProblem(refusal)
    props.onAnswered()
  }
  return (
    <div class="buff-wf-question" data-question={props.question.id}>
      <span class="buff-wf-label">{t("{actor} asks", { actor: props.question.actor })}</span>
      <p>{props.question.text}</p>
      <TextField label={t("Answer")} multiline value={text()} onChange={setText} />
      <Problem text={problem()} />
      <div class="buff-wf-actions">
        <Button size="small" variant="contrast" data-action="buff-wf-answer" onClick={() => void send()}>
          {t("Reply")}
        </Button>
      </div>
    </div>
  )
}
