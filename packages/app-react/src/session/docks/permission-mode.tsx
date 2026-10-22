// Buff's permission mode in the composer (#450), ported from permission-mode.tsx: how far the
// agent is trusted in this session — ask before edits and commands, edit on its own, or full
// access — and the «Plan» mark. The mode is the session's rules, the mark the plan agent; a session
// not created yet remembers the choice and is created with it.

import { SelectMenu } from "@buff/ui/react"
import { BuffPermissionMode as Mode } from "@opencode/schema/buff-permission-mode"
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

  const togglePlan = () => {
    const next = !plan
    // Leaving the plan goes back to the agent it was entered from, else the main one.
    props.selection.setAgent(next ? PLAN : (selection.agents.find((agent) => agent.name !== PLAN)?.name ?? "build"))
    apply(mode ?? remembered, next)
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
      <button
        type="button"
        className="permission-mode__plan"
        data-action="buff-plan-toggle"
        data-active={plan}
        hidden={!hasPlan}
        title={plan ? t("Plan: the agent only reads and drafts a plan. Click to get back to work.") : t("Turn on the plan: the agent does not edit files, it drafts a plan.")}
        onClick={togglePlan}
      >
        {t("Plan")}
      </button>
    </div>
  )
}
