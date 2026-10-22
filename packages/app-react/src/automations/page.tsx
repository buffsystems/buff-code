// The automations page (#447), ported from the Solid window's buff/automations/page.tsx: tasks for
// the agent on a schedule — the list with the next run, the number of runs and the last result,
// filters, running by hand, pausing, editing, the history and the run's session. The console does
// the same (`/automations`); the words are shared, from the schema.

import "./automations.css"
import { Badge, Button, Chip, ChipRow, EmptyState, Panel, type BadgeTone } from "@buff/ui/react"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffSchedule } from "@opencode/schema/buff-schedule"
import { useEffect, useRef, useState } from "react"
import type { Server } from "../core/servers"
import { confirm } from "../dialog/confirm"
import { useDialog } from "../dialog/dialogs"
import { useI18n } from "../i18n/provider"
import { useServerProjects } from "../react/core"
import { useStore } from "../react/use-store"
import { BuffPage, useOpenSession, WithFirstServer } from "../buff/page"
import { showToast } from "../shell/notifications/toast"
import {
  countAutomations,
  createAutomationsController,
  visibleAutomations,
  type AutomationsController,
} from "./controller"
import { AutomationEditor } from "./editor"
import { RunHistory } from "./history"

const STATE: Record<BuffAutomation.State, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "ok" },
  running: { label: "Running", tone: "info" },
  waiting: { label: "Waiting for permission", tone: "warn" },
  failed: { label: "Failed", tone: "crit" },
  paused: { label: "Paused", tone: "neutral" },
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
  return <WithFirstServer>{(server) => <AutomationsPage server={server} />}</WithFirstServer>
}

function AutomationsPage(props: { server: Server }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const dialog = useDialog()
  const openSession = useOpenSession()
  const projects = useServerProjects(props.server)
  const directories = projects.list.map((project) => project.worktree)
  const latest = useRef(directories)
  latest.current = directories
  const [controller] = useState(() =>
    createAutomationsController({
      rpc: props.server.api().rpc(BuffAutomation.Rpc),
      directory: () => latest.current[0],
      confirm: (ask) =>
        confirm(dialog, {
          title: ask.title,
          text: ask.description,
          action: t("Delete"),
          cancel: t("Cancel"),
          danger: true,
        }),
      notify: (text) => showToast({ title: t("Automations"), description: text }),
      t,
    }),
  )
  const state = useStore(controller.store, (value) => value)
  const [now, setNow] = useState(Date.now())

  // «Next run in …» counts from the real now: again on every reload and every 30 seconds.
  useEffect(() => {
    const reload = () => {
      setNow(Date.now())
      void controller.refresh()
    }
    reload()
    const timer = setInterval(reload, REFRESH_MS)
    const stop = props.server.event.listen((event) => {
      if (WATCHED.has(event.type)) reload()
    })
    return () => {
      clearInterval(timer)
      stop()
    }
  }, [controller, props.server])

  const open = (session: string) => openSession(props.server, session)
  const edit = (automation?: BuffAutomation.Automation) =>
    dialog.show((close) => (
      <AutomationEditor
        server={props.server}
        automation={automation}
        directories={directories}
        onClose={close}
        onSave={(draft) => controller.save(automation?.id, draft)}
      />
    ))
  const history = (automation: BuffAutomation.Automation) =>
    dialog.show((close) => (
      <RunHistory automation={automation} controller={controller} onClose={close} onOpenSession={open} />
    ))
  const counts = countAutomations(state.items)

  return (
    <BuffPage component="buff-automations">
      <header className="buff-auto-header">
        <div>
          <h1 className="ui-title ui-title--lg">{t("Automations")}</h1>
          <p className="buff-auto-intro ui-note">
            {t(
              "Tasks for the agent on a schedule. The Buff Code service on this machine runs them — even with the window closed; each run is a new session in the project.",
            )}
          </p>
        </div>
        <Button variant="primary" data-action="buff-automation-new" onClick={() => edit()}>
          {t("New automation")}
        </Button>
      </header>
      <ChipRow label={t("Automations")}>
        {BuffAutomation.FILTERS.map((filter) => (
          <Chip
            key={filter.value}
            size="sm"
            pressed={state.filter === filter.value}
            count={counts[filter.value]}
            onClick={() => controller.setFilter(filter.value)}
          >
            {t(filter.label)}
          </Chip>
        ))}
      </ChipRow>
      {state.loaded && !state.items.length && (
        <EmptyState inline>
          <span data-slot="buff-auto-empty">
            {t(
              "No automations yet. Create the first one with the «New automation» button — or ask the agent in the chat: «every morning at 9 check the build and write what failed».",
            )}
          </span>
        </EmptyState>
      )}
      <div className="buff-auto-list">
        {visibleAutomations(state).map((automation) => (
          <AutomationCard
            key={automation.id}
            automation={automation}
            now={now}
            controller={controller}
            onEdit={() => edit(automation)}
            onHistory={() => history(automation)}
            onOpenSession={open}
          />
        ))}
      </div>
    </BuffPage>
  )
}

function AutomationCard(props: {
  automation: BuffAutomation.Automation
  now: number
  controller: AutomationsController
  onEdit: () => void
  onHistory: () => void
  onOpenSession: (session: string) => void
}) {
  const i18n = useI18n()
  const { t, n } = i18n.buff
  const automation = props.automation
  const state = BuffAutomation.stateOf(automation)
  const going = state === "running" || state === "waiting"
  const last = automation.last
  return (
    <Panel className="buff-auto-card" data-automation={automation.id} data-state={state}>
      <div className="buff-auto-card-head">
        <span className="buff-auto-card-title ui-title ui-title--sm">{automation.title}</span>
        <Badge size="sm" tone={STATE[state].tone} data-state={state}>
          {t(STATE[state].label)}
        </Badge>
      </div>
      <div className="buff-auto-card-line">
        {BuffSchedule.summary(automation.schedule, t, n)} · {folder(automation.directory)}
      </div>
      <div className="buff-auto-card-line ui-note">
        {automation.paused
          ? t("Paused — does not run on schedule")
          : t("Next run — {when}", {
              when: BuffSchedule.nextLabel(new Date(automation.next), new Date(props.now), t),
            })}
        {" · "}
        {t("Runs: {count}", { count: automation.count })}
      </div>
      {last && (
        <div className="buff-auto-card-line" data-slot="buff-auto-last" data-status={last.status}>
          {t("Last: {run}", { run: BuffAutomation.runLabel(last, t, n) })}
        </div>
      )}
      <div className="buff-auto-card-actions">
        {going ? (
          <Button size="sm" data-action="buff-auto-stop" onClick={() => void props.controller.stop(automation.id)}>
            {t("Stop")}
          </Button>
        ) : (
          <Button size="sm" data-action="buff-auto-run" onClick={() => void props.controller.runNow(automation.id)}>
            {t("Run now")}
          </Button>
        )}
        {last?.session && (
          <Button
            size="sm"
            variant="ghost"
            data-action="buff-auto-open"
            onClick={() => last.session && props.onOpenSession(last.session)}
          >
            {state === "waiting" ? t("Answer in the session") : t("Open session")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          data-action="buff-auto-pause"
          onClick={() => void props.controller.pause(automation.id, !automation.paused)}
        >
          {automation.paused ? t("Resume") : t("Pause")}
        </Button>
        <Button size="sm" variant="ghost" data-action="buff-auto-edit" onClick={props.onEdit}>
          {t("Edit")}
        </Button>
        <Button size="sm" variant="ghost" data-action="buff-auto-history" onClick={props.onHistory}>
          {t("History")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-action="buff-auto-remove"
          onClick={() => void props.controller.remove(automation.id)}
        >
          {t("Delete")}
        </Button>
      </div>
    </Panel>
  )
}
