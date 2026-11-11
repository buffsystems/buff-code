// Buff's permission mode in the composer (#450), ported from permission-mode.tsx: how far the
// agent is trusted in this session — ask before edits and commands, edit on its own, or full
// access — and the «Plan» mark. The mode is the session's rules, the mark the plan agent; a session
// not created yet remembers the choice and is created with it. Beside «Plan» sits the «Setup» toggle
// (#775/#860): the setup agent, which connects the agent to services, accounts and folders.

import { SelectMenu } from "@buff/ui/react"
import { BuffPermissionMode as Mode } from "@opencode/schema/buff-permission-mode"
import { BuffSetup } from "@opencode/schema/buff-setup"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { useEffect, useState } from "react"
import { planByDefault, preferMode, preferredMode } from "../../buff/permission-preference"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import { useStore } from "../../react/use-store"
import { showToast } from "../../shell/notifications/toast"
import type { ModelSelectionHandle } from "../composer/models/use-selection"
import type { Server } from "../../core/servers"
import "./docks.css"

const PLAN = "plan"

/** The work mode (#894): what the agent is doing — working, drafting a plan, or setting itself up. */
type WorkMode = "work" | "plan" | "setup"
const WORK_MODES = [
  { value: "work", label: "Work", hint: "Work: the agent does the task — reads, edits and runs by the permission mode." },
  { value: "plan", label: "Plan", hint: "Plan: the agent does not edit files, it drafts a plan." },
  { value: "setup", label: "Setup", hint: "Setup: the agent connects itself to a service, an account or a folder you need." },
] as const

/** The rules a new session is created with, by the remembered mode. */
export function newSessionPermissions(agent: string | undefined) {
  return Mode.rules(preferredMode.get(), agent === PLAN)
}

/** In a session: its rules; in a draft: the remembered mode, applied when the session is created. */
export function PermissionModeControl(props: { selection: ModelSelectionHandle; server: Server; sessionID?: string }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const selection = props.selection.selection
  const plan = selection.agent?.name === PLAN
  const hasPlan = selection.agents.some((agent) => agent.name === PLAN)
  const setup = selection.agent?.name === BuffSetup.AGENT
  const hasSetup = selection.agents.some((agent) => agent.name === BuffSetup.AGENT)
  // Leaving Plan or Setup goes back to the working agent: the first that is neither, else the main one.
  const working = selection.agents.find((agent) => agent.name !== PLAN && agent.name !== BuffSetup.AGENT)?.name ?? "build"
  const permissions = useServerData(props.server, (state) =>
    props.sessionID ? state.session.info[props.sessionID]?.permissions : undefined,
  )
  const exists = useServerData(props.server, (state) => !!props.sessionID && !!state.session.info[props.sessionID])
  const remembered = useStore(preferredMode, (mode) => mode)
  const mode = exists ? Mode.modeOf(permissions, plan) : remembered
  const options = [
    ...(mode ? [] : [{ value: "custom", label: Mode.short(undefined, t), description: t("The rules of this session are not set by a mode.") }]),
    ...Mode.MODES.map((item) => ({ value: item.value, label: t(item.label), description: t(item.hint) })),
  ]

  const apply = (next: Mode.Mode, planned: boolean) => {
    preferMode(next)
    if (!props.sessionID || !exists) return
    void props.server
      .api()
      .session.update({ sessionID: props.sessionID, permissions: Mode.rules(next, planned) })
      .catch((error: unknown) =>
        showToast({ title: t("Permission mode"), description: formatServerError(error, undefined, t("Could not change the mode.")) }),
      )
  }
  // A new session starts in «Plan» if the onboarding chose so (#457).
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (started || !hasPlan || exists) return
    setStarted(true)
    if (planByDefault() && !plan) props.selection.setAgent(PLAN)
  }, [started, hasPlan, exists, plan, props.selection])

  // The work mode (#894): one visible switch — Work, Plan, Setup; the agent of the mode is picked,
  // and the permission rules follow Plan in and out.
  const work: WorkMode = plan ? "plan" : setup ? "setup" : "work"
  const works = WORK_MODES.filter((item) => item.value === "work" || (item.value === "plan" ? hasPlan : hasSetup))
  const pickWork = (next: WorkMode) => {
    if (next === work) return
    props.selection.setAgent(next === "plan" ? PLAN : next === "setup" ? BuffSetup.AGENT : working)
    if (plan || next === "plan") apply(mode ?? remembered, next === "plan")
  }

  return (
    <div className="permission-mode" data-component="buff-permission-mode" data-mode={mode ?? "custom"}>
      <SelectMenu
        variant="ghost"
        compact
        aria-label={t("Permission mode")}
        options={options}
        value={mode ?? "custom"}
        onValueChange={(value) => {
          const next = Mode.MODES.find((item) => item.value === value)
          if (next) apply(next.value, plan)
        }}
        className="permission-mode__select"
      />
      {works.length > 1 && (
        <div
          role="radiogroup"
          aria-label={t("Work mode")}
          className="permission-mode__work"
          data-component="buff-work-mode"
          data-mode={work}
        >
          {works.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={work === item.value}
              className="permission-mode__plan"
              data-action="buff-work-mode"
              data-work={item.value}
              data-active={work === item.value}
              title={t(item.hint)}
              onClick={() => pickWork(item.value)}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
