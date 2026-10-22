import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffSchedule } from "@opencode/schema/buff-schedule"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"
import { openNotificationSession } from "@/shell/notifications/notification"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
import { BuffPage } from "../page-panel"
import { ServerScope } from "../server-scope"
import { askConfirm } from "../settings-kit"
import { useBuffText } from "../i18n"
import { createAutomationsController, type AutomationsController } from "./controller"
import { AutomationEditor } from "./editor"
import { RunHistory } from "./history"
import "./automations.css"

/**
 * Страница «Автоматизации» (#447): задачи агенту по расписанию — список со следующим запуском,
 * числом запусков и последним итогом, фильтры, запуск вручную, пауза, правка, история и переход
 * в сессию запуска. То же умеет консоль (`/automations`); слова — общие, из схемы.
 */

const STATE_LABEL: Record<BuffAutomation.State, string> = {
  active: "Active",
  running: "Running",
  waiting: "Waiting for permission",
  failed: "Failed",
  paused: "Paused",
}
const REFRESH_MS = 30_000
const WATCHED = new Set([
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "permission.asked",
  "permission.replied",
])
const folder = (directory: string) => directory.split(/[\\/]/).filter(Boolean).pop() ?? directory

export function AutomationsScreen() {
  return (
    <ServerScope>
      <AutomationsPage />
    </ServerScope>
  )
}

function AutomationsPage() {
  const sdk = useServerSDK()
  const server = useServer()
  const dialog = useDialog()
  const tabs = useTabs()
  const { t } = useBuffText()
  const directories = createMemo(() => server.ctx.projects.list().map((project) => project.worktree))
  const controller = createAutomationsController({
    rpc: sdk.api.rpc(BuffAutomation.Rpc),
    directory: () => directories()[0],
    confirm: (ask) => askConfirm(dialog, { title: ask.title, text: ask.description, action: t("Delete") }),
    notify: (text) => showToast({ title: t("Automations"), description: text }),
    t,
  })
  const [now, setNow] = createSignal(Date.now())

  // «Следующий запуск через …» — от настоящего «сейчас»: пересчёт при каждом обновлении списка и раз в 30 с.
  const current = () => {
    controller.items()
    now()
    return Date.now()
  }
  const reload = () => {
    setNow(Date.now())
    return controller.refresh()
  }
  onMount(() => {
    void reload()
    const timer = setInterval(() => void reload(), REFRESH_MS)
    const unsubscribe = sdk.event.listen((event) => {
      if (WATCHED.has(event.type)) void reload()
    })
    onCleanup(() => {
      clearInterval(timer)
      unsubscribe()
    })
  })

  const openSession = (session: string) => openNotificationSession(tabs, server.key, session)
  const edit = (automation?: BuffAutomation.Automation) =>
    void dialog.show(() => (
      <AutomationEditor
        automation={automation}
        directories={directories()}
        onSave={(draft) => controller.save(automation?.id, draft)}
      />
    ))
  const history = (automation: BuffAutomation.Automation) =>
    void dialog.show(() => <RunHistory automation={automation} controller={controller} onOpenSession={openSession} />)

  return (
    <BuffPage component="buff-automations">
      <header class="buff-auto-header">
        <div>
          <h1 class="buff-auto-title">{t("Automations")}</h1>
          <p class="buff-auto-intro">
            {t(
              "Tasks for the agent on a schedule. The Buff Code service on this machine runs them — even with the window closed; each run is a new session in the project.",
            )}
          </p>
        </div>
        <Button variant="contrast" data-action="buff-automation-new" onClick={() => edit()}>
          {t("New automation")}
        </Button>
      </header>
      <div class="buff-auto-filters" role="tablist">
        <For each={BuffAutomation.FILTERS}>
          {(filter) => (
            <button
              type="button"
              class="buff-kit-choice-item"
              data-filter={filter.value}
              data-active={controller.filter() === filter.value}
              onClick={() => controller.setFilter(filter.value)}
            >
              {t(filter.label)}
              <span class="buff-kit-count">{controller.counts()[filter.value]}</span>
            </button>
          )}
        </For>
      </div>
      <Show when={controller.loaded() && !controller.items().length}>
        <div class="buff-auto-empty" data-slot="buff-auto-empty">
          {t(
            "No automations yet. Create the first one with the «New automation» button — or ask the agent in the chat: «every morning at 9 check the build and write what failed».",
          )}
        </div>
      </Show>
      <div class="buff-auto-list">
        <For each={controller.visible()}>
          {(automation) => (
            <Card
              automation={automation}
              now={current()}
              controller={controller}
              onEdit={() => edit(automation)}
              onHistory={() => history(automation)}
              onOpenSession={openSession}
            />
          )}
        </For>
      </div>
    </BuffPage>
  )
}

function Card(props: {
  automation: BuffAutomation.Automation
  now: number
  controller: AutomationsController
  onEdit: () => void
  onHistory: () => void
  onOpenSession: (session: string) => void
}) {
  const { t, n } = useBuffText()
  const state = () => BuffAutomation.stateOf(props.automation)
  const going = () => state() === "running" || state() === "waiting"
  const last = () => props.automation.last
  return (
    <article class="buff-auto-card" data-automation={props.automation.id} data-state={state()}>
      <div class="buff-auto-card-head">
        <span class="buff-auto-card-title">{props.automation.title}</span>
        <span class="buff-auto-badge" data-state={state()}>
          {t(STATE_LABEL[state()])}
        </span>
      </div>
      <div class="buff-auto-card-line">
        {BuffSchedule.summary(props.automation.schedule, t, n)} · {folder(props.automation.directory)}
      </div>
      <div class="buff-auto-card-line buff-auto-card-weak">
        {props.automation.paused
          ? t("Paused — does not run on schedule")
          : t("Next run — {when}", {
              when: BuffSchedule.nextLabel(new Date(props.automation.next), new Date(props.now), t),
            })}
        {" · "}
        {t("Runs: {count}", { count: props.automation.count })}
      </div>
      <Show when={last()}>
        {(run) => (
          <div class="buff-auto-card-line" data-slot="buff-auto-last" data-status={run().status}>
            {t("Last: {run}", { run: BuffAutomation.runLabel(run(), t, n) })}
          </div>
        )}
      </Show>
      <div class="buff-auto-card-actions">
        <Show
          when={going()}
          fallback={
            <Button
              size="small"
              variant="neutral"
              data-action="buff-auto-run"
              onClick={() => void props.controller.runNow(props.automation.id)}
            >
              {t("Run now")}
            </Button>
          }
        >
          <Button
            size="small"
            variant="neutral"
            data-action="buff-auto-stop"
            onClick={() => void props.controller.stop(props.automation.id)}
          >
            {t("Stop")}
          </Button>
        </Show>
        <Show when={last()?.session}>
          {(session) => (
            <Button
              size="small"
              variant="ghost"
              data-action="buff-auto-open"
              onClick={() => props.onOpenSession(session())}
            >
              {state() === "waiting" ? t("Answer in the session") : t("Open session")}
            </Button>
          )}
        </Show>
        <Button
          size="small"
          variant="ghost"
          data-action="buff-auto-pause"
          onClick={() => void props.controller.pause(props.automation.id, !props.automation.paused)}
        >
          {props.automation.paused ? t("Resume") : t("Pause")}
        </Button>
        <Button size="small" variant="ghost" data-action="buff-auto-edit" onClick={props.onEdit}>
          {t("Edit")}
        </Button>
        <Button size="small" variant="ghost" data-action="buff-auto-history" onClick={props.onHistory}>
          {t("History")}
        </Button>
        <Button
          size="small"
          variant="ghost"
          data-action="buff-auto-remove"
          onClick={() => void props.controller.remove(props.automation.id)}
        >
          {t("Delete")}
        </Button>
      </div>
    </article>
  )
}
