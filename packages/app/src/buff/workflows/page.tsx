import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { useDialog } from "@opencode/ui/context/dialog"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"
import { openNotificationSession } from "@/shell/notifications/notification"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import { useBuffText } from "../i18n"
import { BuffPage } from "../page-panel"
import { ServerScope } from "../server-scope"
import { askConfirm } from "../settings-kit"
import { RunCard, SavedCard } from "./cards"
import { createWorkflowsController } from "./controller"
import { WorkflowDetail } from "./detail"
import { RunView } from "./run-view"
import { StartDialog } from "./start-dialog"
import "./workflows.css"

/**
 * Страница «Сценарии» (#448): сохранённые сценарии — описание, аргументы, последний прогон,
 * запуск с аргументами, детали с правкой описания; прогоны — состояние, фаза, время, метрики,
 * просмотр хода. Пишет и правит сценарии агент в чате. То же умеет консоль (`/workflows`).
 */

type View = "saved" | "runs"
const REFRESH_MS = 5_000

export function WorkflowsScreen() {
  return (
    <ServerScope>
      <WorkflowsPage />
    </ServerScope>
  )
}

function WorkflowsPage() {
  const sdk = useServerSDK()
  const server = useServer()
  const dialog = useDialog()
  const tabs = useTabs()
  const platform = usePlatform()
  const { t } = useBuffText()
  const directories = createMemo(() => server.ctx.projects.list().map((project) => project.worktree))
  const controller = createWorkflowsController({
    rpc: sdk.api.rpc(BuffWorkflowRpc.Rpc),
    directory: () => directories()[0],
    confirm: (ask) => askConfirm(dialog, { title: ask.title, text: ask.description, action: t("Delete") }),
    notify: (text) => showToast({ title: t("Workflows"), description: text }),
    t,
  })
  const [view, setView] = createSignal<View>("saved")
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    void controller.refresh()
    const timer = setInterval(() => {
      setNow(Date.now())
      if (controller.counts().running) void controller.refresh()
    }, REFRESH_MS)
    const unsubscribe = sdk.event.listen((event) => {
      if (event.type.startsWith("session.execution.")) void controller.refresh()
    })
    onCleanup(() => {
      clearInterval(timer)
      unsubscribe()
    })
  })

  const openSession = (session: string) => openNotificationSession(tabs, server.key, session)
  const chat = (directory: string, prompt: string) => void tabs.newDraft({ server: server.key, directory }, prompt)
  const openFile = platform.openPath ? (path: string) => void platform.openPath?.(path) : undefined
  const showRun = (id: string) =>
    void dialog.show(() => (
      <RunView
        id={id}
        controller={controller}
        onOpenSession={openSession}
        onFixInChat={(run) => chat(run.directory, BuffWorkflowFlow.fixRun(run, t))}
        onOpenFile={openFile}
      />
    ))
  const start = (saved: BuffWorkflowRpc.Saved) =>
    void dialog.show(() => (
      <StartDialog
        meta={saved.meta}
        directories={directories()}
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
    void dialog.show(() => (
      <WorkflowDetail
        meta={read.meta}
        script={read.script}
        path={read.path}
        onSave={(meta) => controller.saveMeta(saved.meta.name, meta)}
        onStart={() => start(saved)}
        onFixInChat={() => chat(directories()[0] ?? "", BuffWorkflowFlow.fixSaved(saved.meta.name, read.path, t))}
        onRemove={() => void controller.remove(saved.meta.name)}
      />
    ))
  }

  return (
    <BuffPage component="buff-workflows">
      <header class="buff-wf-header">
        <div>
          <h1 class="buff-wf-title">{t("Workflows")}</h1>
          <p class="buff-wf-intro">
            {t(
              "Scripts that subagents follow phase by phase, with checks in code and a final result. The agent writes and edits them: ask in the chat “make a workflow that…”. Here are the saved workflows and the progress of their runs.",
            )}
          </p>
        </div>
      </header>
      <div class="buff-wf-filters" role="tablist">
        <button
          type="button"
          class="buff-kit-choice-item"
          data-view="saved"
          data-active={view() === "saved"}
          onClick={() => setView("saved")}
        >
          {t("Saved")}
          <span class="buff-kit-count">{controller.counts().saved}</span>
        </button>
        <button
          type="button"
          class="buff-kit-choice-item"
          data-view="runs"
          data-active={view() === "runs"}
          onClick={() => setView("runs")}
        >
          {t("Runs")}
          <span class="buff-kit-count">{controller.counts().runs}</span>
          {controller.counts().running ? ` ${t("(running: {count})", { count: controller.counts().running })}` : ""}
        </button>
      </div>
      <Show when={view() === "saved"}>
        <Show when={controller.loaded() && !controller.saved().length && !controller.invalid().length}>
          <div class="buff-wf-empty" data-slot="buff-wf-empty">
            {t(
              "No saved workflows yet. Ask the agent in the chat: “make a workflow: three reviewers look at the changes, a fourth sums up” — and once it works, “save it”.",
            )}
          </div>
        </Show>
        <div class="buff-wf-list">
          <For each={controller.saved()}>
            {(saved) => (
              <SavedCard
                saved={saved}
                onStart={() => start(saved)}
                onDetail={() => void detail(saved)}
                onRun={showRun}
              />
            )}
          </For>
          <For each={controller.invalid()}>
            {(item) => (
              <article class="buff-wf-card" data-state="invalid">
                <span class="buff-wf-card-title">{item.path}</span>
                <span class="buff-wf-weak">{t("Unreadable: {problem}", { problem: t(item.problem) })}</span>
              </article>
            )}
          </For>
        </div>
      </Show>
      <Show when={view() === "runs"}>
        <Show when={controller.loaded() && !controller.runs().length}>
          <div class="buff-wf-empty">{t("No runs yet.")}</div>
        </Show>
        <div class="buff-wf-list">
          <For each={controller.runs()}>
            {(run) => <RunCard run={run} now={now()} controller={controller} onOpen={() => showRun(run.id)} />}
          </For>
        </div>
      </Show>
    </BuffPage>
  )
}
