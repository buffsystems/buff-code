// Getting to know Buff Code (#457), ported from the Solid window's buff/onboarding.tsx: its
// steps, and every choice changes something — what the person does sets the permissions mode and
// «Plan» of new sessions, the theme (light, dark or as the system) and the text size the window's
// look, the last step project memory and the hooks check. «Skip» on any step; the steps and words
// are BuffFirstRun's.

import "./onboarding.css"
import { Button, Dialog, DialogBody, DialogFooter, RadioGroup, RadioItem, useTheme, type Theme } from "@buff/ui/react"
import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import { BuffMemory } from "@opencode/schema/buff-memory"
import { BuffTrust } from "@opencode/schema/buff-trust"
import { ChartColumn, Plug, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import type { Server } from "../../core/servers"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import { useStore } from "../../react/use-store"
import { SettingsList, SwitchRow } from "../../settings/kit"
import { preferForNewSessions } from "../permission-preference"
import { setUiSize, textSize, UI } from "../text-size"
import { markOnboardingDone } from "./state"

type Role = BuffFirstRun.Role["value"]

// The window's steps (#972): what the person does, how a chat is shown, how the window looks,
// what to turn on. The second is the window's own — the console's introduction has none.
// The last (#595) picks nothing: it says that Buff Code extends itself and where to ask for it.
const STEPS = [
  BuffFirstRun.STEPS[0],
  BuffFirstRun.LAYOUT_STEP,
  BuffFirstRun.STEPS[1],
  BuffFirstRun.STEPS[2],
  BuffFirstRun.SETUP_STEP,
] as const

export function OnboardingDialog(props: {
  server: Server
  /** The chat layout picked (#972). A dialog is drawn outside the settings' provider: its host sets it. */
  onLayout: (layout: BuffFirstRun.Layout["value"]) => void
  /** What the step starts on: «simple» at a first launch, the person's own choice when shown again. */
  layout: BuffFirstRun.Layout["value"]
  onClose: () => void
}) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const dialog = useDialog()
  const theme = useTheme()
  const size = useStore(textSize, (value) => value.ui)
  const [step, setStep] = useState(0)
  const [role, setRole] = useState<Role>("develop")
  // #972: a new install picks how a chat is shown; «simple» is the start for someone who came
  // to talk to the agent. An install that never saw this step keeps the developer layout.
  const [layout, setLayout] = useState<BuffFirstRun.Layout["value"]>(props.layout)
  const [memory, setMemory] = useState(true)
  const [askFirst, setAskFirst] = useState(true)
  const signedIn = useBuffSignedIn(props.server)

  useEffect(() => {
    const api = props.server.api()
    void api
      .rpc(BuffMemory.Rpc)
      .list()
      .then(
        (state) => setMemory(state.enabled),
        () => undefined,
      )
    void api
      .rpc(BuffTrust.Rpc)
      .get()
      .then(
        (state) => setAskFirst(state.askFirst),
        () => undefined,
      )
  }, [props.server])

  const finish = async () => {
    const chosen = BuffFirstRun.ROLES.find((item) => item.value === role)
    if (chosen) preferForNewSessions(chosen.mode, chosen.plan)
    props.onLayout(layout)
    const api = props.server.api()
    await Promise.all([
      api
        .rpc(BuffMemory.Rpc)
        .enable({ enabled: memory })
        .catch(() => undefined),
      api
        .rpc(BuffTrust.Rpc)
        .set({ askFirst })
        .catch(() => undefined),
    ])
    markOnboardingDone()
    props.onClose()
    // Sign-in follows the introduction at once, so the window does not flash an empty screen.
    // The sign-in replaces the introduction in place: the providers' connect dialog, on Buff.
    if (!signedIn)
      void import("../../providers/connect/open").then((module) =>
        module.openBuffSignIn(dialog, { server: props.server, directory: "" }),
      )
  }
  const skip = () => {
    // #972: a layout the person saw and went on from is their choice, even if the rest is skipped.
    if (step > STEPS.indexOf(BuffFirstRun.LAYOUT_STEP)) props.onLayout(layout)
    markOnboardingDone()
    props.onClose()
  }
  const last = step === STEPS.length - 1
  const current = STEPS[step]
  const counter = t("Step {n} of {total}", { n: step + 1, total: STEPS.length })

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && skip()}
      title={t("Getting to know Buff Code")}
      closeLabel={t("Close")}
    >
      <DialogBody>
        <div className="flex flex-col gap-4" data-component="buff-onboarding" data-step={step + 1}>
          <div className="buff-onboarding-progress" aria-label={counter}>
            {STEPS.map((item, index) => (
              <span key={item.title} className="buff-onboarding-dot" data-active={index <= step} />
            ))}
            <span className="ui-hint ms-1.5">{counter}</span>
          </div>
          <div>
            <h3 className="ui-title ui-title--lg">{t(current?.title ?? "")}</h3>
            <p className="ui-note">{t(current?.note ?? "")}</p>
          </div>
          {step === 0 && (
            <RadioGroup
              aria-label={t(current?.title ?? "")}
              value={role}
              onValueChange={(value) => setRole(pickRole(value))}
            >
              {BuffFirstRun.ROLES.map((item) => (
                <RadioItem key={item.value} value={item.value} label={t(item.title)} hint={t(item.note)} />
              ))}
            </RadioGroup>
          )}
          {current === BuffFirstRun.LAYOUT_STEP && (
            <RadioGroup
              aria-label={t(current.title)}
              value={layout}
              onValueChange={(value) => setLayout(value === "developer" ? "developer" : "simple")}
            >
              {BuffFirstRun.LAYOUTS.map((item) => (
                <RadioItem key={item.value} value={item.value} label={t(item.title)} hint={t(item.note)} />
              ))}
            </RadioGroup>
          )}
          {current === BuffFirstRun.STEPS[1] && (
            <>
              <RadioGroup
                aria-label={t(current?.title ?? "")}
                value={theme.theme}
                onValueChange={(value) => theme.setTheme(pickTheme(value))}
              >
                {BuffFirstRun.THEMES.map((item) => (
                  <RadioItem key={item.value} value={item.value} label={t(item.title)} />
                ))}
              </RadioGroup>
              {/* #461: the text size, seen on this window at once. */}
              <label className="flex items-center gap-3 text-sm">
                <span>{t("Text size")}</span>
                <input
                  type="range"
                  className="w-40 accent-primary"
                  min={UI.min}
                  max={UI.max}
                  step={1}
                  value={size}
                  aria-label={t("Text size")}
                  data-action="buff-onboarding-size"
                  onChange={(event) => setUiSize(Number(event.currentTarget.value))}
                />
                <span className="ui-hint ui-num">{size} px</span>
              </label>
            </>
          )}
          {current === BuffFirstRun.STEPS[2] && (
            <SettingsList>
              <SwitchRow
                action="buff-onboarding-memory"
                title={t(BuffFirstRun.MEMORY.title)}
                description={t(BuffFirstRun.MEMORY.note)}
                checked={memory}
                onChange={setMemory}
              />
              <SwitchRow
                action="buff-onboarding-ask-first"
                title={t(BuffFirstRun.ASK_FIRST.title)}
                description={t(BuffFirstRun.ASK_FIRST.note)}
                checked={askFirst}
                onChange={setAskFirst}
              />
            </SettingsList>
          )}
          {current === BuffFirstRun.SETUP_STEP && (
            <ul className="flex flex-col gap-3" data-component="buff-onboarding-setup">
              {BuffFirstRun.SETUP_POINTS.map((point, index) => {
                const Icon = SETUP_ICONS[index] ?? Sparkles
                return (
                  <li key={point.title} className="flex items-start gap-3">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div>
                      <div className="text-sm font-medium">{t(point.title)}</div>
                      <div className="ui-hint">{t(point.note)}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" data-action="buff-onboarding-skip" onClick={skip}>
          {t("Skip")}
        </Button>
        <span className="flex-1" />
        {step > 0 && (
          <Button data-action="buff-onboarding-back" onClick={() => setStep(step - 1)}>
            {t("Back")}
          </Button>
        )}
        {last ? (
          <Button variant="primary" data-action="buff-onboarding-finish" onClick={() => void finish()}>
            {signedIn ? t("Done") : t("Sign in to Buff")}
          </Button>
        ) : (
          <Button variant="primary" data-action="buff-onboarding-next" onClick={() => setStep(step + 1)}>
            {t("Next")}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}

const SETUP_ICONS = [Plug, ChartColumn, Sparkles] as const

const pickRole = (value: string): Role => BuffFirstRun.ROLES.find((item) => item.value === value)?.value ?? "develop"
const pickTheme = (value: string): Theme => BuffFirstRun.THEMES.find((item) => item.value === value)?.value ?? "system"

/** Signed in to Buff: the buff integration has a credential (the Solid window's buffSignedIn). */
function useBuffSignedIn(server: Server) {
  const integrations = useServerData(server, () => server.data.location.integration.list())
  useEffect(() => {
    void server.data.location.integration.sync().catch(() => undefined)
  }, [server])
  // #966: a personal Buff account is a sign-in as well as the company's.
  return !!integrations?.some(
    (integration) =>
      (integration.id === "buff" || integration.id === "buff-account") &&
      integration.connections.some((connection) => connection.type === "credential"),
  )
}
