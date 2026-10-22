// The workflows page (#448), ported from the Solid window's buff/workflows/page.tsx: saved
// workflows — description, arguments, last run, starting with arguments, the detail with the
// editable description — and runs — state, phase, time, metrics, the progress view. The agent
// writes and edits workflows in the chat; the console does the same (`/workflows`).

import "./workflows.css"
import { Chip, ChipRow, EmptyState, Panel } from "@buff/ui/react"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { useEffect, useRef, useState } from "react"
import { leaveDraftPrompt } from "../buff/draft-prompt"
import { BuffPage, useOpenSession, WithFirstServer } from "../buff/page"
import type { Server } from "../core/servers"
import { confirm } from "../dialog/confirm"
import { useDialog } from "../dialog/dialogs"
import { useI18n } from "../i18n/provider"
import { useServerProjects } from "../react/core"
import { useStore } from "../react/use-store"
import { showToast } from "../shell/notifications/toast"
import { tabServer } from "../shell/tabs/tabs"
import { useTabs } from "../shell/tabs/provider"
import { RunCard, SavedCard } from "./cards"
import { createWorkflowsController, workflowCounts } from "./controller"
import { WorkflowDetail } from "./detail"
import { RunView } from "./run-view"
import { StartDialog } from "./start-dialog"

const REFRESH_MS = 5_000

export function WorkflowsScreen() {
  return <WithFirstServer>{(server) => <WorkflowsPage server={server} />}</WithFirstServer>
}

function WorkflowsPage(props: { server: Server }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const dialog = useDialog()
  const tabs = useTabs()
  const openSession = useOpenSession()
  const projects = useServerProjects(props.server)
  const directories = projects.list.map((project) => project.worktree)
  const latest = useRef(directories)
  latest.current = directories
  const [controller] = useState(() =>
    createWorkflowsController({
      rpc: props.server.api().rpc(BuffWorkflowRpc.Rpc),
      directory: () => latest.current[0],
      confirm: (ask) =>
        confirm(dialog, {
          title: ask.title,
          text: ask.description,
          action: t("Delete"),
          cancel: t("Cancel"),
          danger: true,
        }),
      notify: (text) => showToast({ title: t("Workflows"), description: text }),
      t,
    }),
  )
  const state = useStore(controller.store, (value) => value)
  const counts = workflowCounts(state)
  const [view, setView] = useState<"saved" | "runs">("saved")
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    void controller.refresh()
    const timer = setInterval(() => {
      setNow(Date.now())
      if (workflowCounts(controller.store.get()).running) void controller.refresh()
    }, REFRESH_MS)
    const stop = props.server.event.listen((event) => {
      if (event.type.startsWith("session.execution.")) void controller.refresh()
    })
    return () => {
      clearInterval(timer)
      stop()
    }
  }, [controller, props.server])

  const open = (session: string) => openSession(props.server, session)
  // «Fix in chat»: a new draft in the project with the prompt already written.
  const chat = (directory: string, prompt: string) =>
    leaveDraftPrompt(tabs.newDraft({ server: tabServer(props.server.key), directory }).draftID, prompt)
  const showRun = (id: string) =>
    dialog.show((close) => (
      <RunView
        id={id}
        server={props.server}
        controller={controller}
        onClose={close}
        onOpenSession={open}
        onFixInChat={(run) => chat(run.directory, BuffWorkflowFlow.fixRun(run, t))}
      />
    ))
  const start = (saved: BuffWorkflowRpc.Saved) =>
    dialog.show((close) => (
      <StartDialog
        meta={saved.meta}
        directories={latest.current}
        onClose={close}
        onStart={(args, directory) => controller.start(saved.meta.name, args, directory)}
        onStarted={(run) => {
          setView("runs")
          showRun(run)
        }}
      />
    ))
  const detail = async (saved: BuffWorkflowRpc.Saved) => {
    const read = await controller.read(saved.meta.name)
    if (!read) return
    dialog.show((close) => (
      <WorkflowDetail
        meta={read.meta}
        script={read.script}
        path={read.path}
        onClose={close}
        onSave={(meta) => controller.saveMeta(saved.meta.name, meta)}
        onStart={() => start(saved)}
        onFixInChat={() => chat(latest.current[0] ?? "", BuffWorkflowFlow.fixSaved(saved.meta.name, read.path, t))}
        onRemove={() => void controller.remove(saved.meta.name)}
      />
    ))
  }

  return (
    <BuffPage component="buff-workflows">
      <header>
        <h1 className="ui-title ui-title--lg">{t("Workflows")}</h1>
        <p className="buff-wf-intro ui-note">
          {t(
            "Scripts that subagents follow phase by phase, with checks in code and a final result. The agent writes and edits them: ask in the chat “make a workflow that…”. Here are the saved workflows and the progress of their runs.",
          )}
        </p>
      </header>
      <ChipRow label={t("Workflows")}>
        <Chip size="sm" pressed={view === "saved"} count={counts.saved} onClick={() => setView("saved")}>
          {t("Saved")}
        </Chip>
        <Chip size="sm" pressed={view === "runs"} count={counts.runs} onClick={() => setView("runs")}>
          {t("Runs")}
          {counts.running ? ` ${t("(running: {count})", { count: counts.running })}` : ""}
        </Chip>
      </ChipRow>
      {view === "saved" && (
        <>
          {state.loaded && !state.saved.length && !state.invalid.length && (
            <EmptyState inline>
              <span data-slot="buff-wf-empty">
                {t(
                  "No saved workflows yet. Ask the agent in the chat: “make a workflow: three reviewers look at the changes, a fourth sums up” — and once it works, “save it”.",
                )}
              </span>
            </EmptyState>
          )}
          <div className="buff-wf-list">
            {state.saved.map((saved) => (
              <SavedCard
                key={saved.meta.name}
                saved={saved}
                onStart={() => start(saved)}
                onDetail={() => void detail(saved)}
                onRun={showRun}
              />
            ))}
            {state.invalid.map((item) => (
              <Panel key={item.path} className="buff-wf-card" data-state="invalid">
                <span className="buff-wf-card-title ui-title ui-title--sm">{item.path}</span>
                <span className="ui-error">{t("Unreadable: {problem}", { problem: t(item.problem) })}</span>
              </Panel>
            ))}
          </div>
        </>
      )}
      {view === "runs" && (
        <>
          {state.loaded && !state.runs.length && <EmptyState inline>{t("No runs yet.")}</EmptyState>}
          <div className="buff-wf-list">
            {state.runs.map((run) => (
              <RunCard key={run.id} run={run} now={now} controller={controller} onOpen={() => showRun(run.id)} />
            ))}
          </div>
        </>
      )}
    </BuffPage>
  )
}
