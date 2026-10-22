// Getting to know Buff Code (#457), ported from the Solid window's buff/onboarding.tsx: three
// steps, and every choice changes something — what the person does sets the permissions mode and
// «Plan» of new sessions, the theme (light, dark or as the system) and the text size the window's
// look, the last step project memory and the hooks check. «Skip» on any step; the steps and words
// are BuffFirstRun's.

import "./onboarding.css"
import { Button, Dialog, DialogBody, DialogFooter, RadioGroup, RadioItem, useTheme, type Theme } from "@buff/ui/react"
import { BuffFirstRun } from "@opencode/schema/buff-first-run"
import { BuffMemory } from "@opencode/schema/buff-memory"
import { BuffTrust } from "@opencode/schema/buff-trust"
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

export function OnboardingDialog(props: { server: Server; onClose: () => void }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const dialog = useDialog()
  const theme = useTheme()
  const size = useStore(textSize, (value) => value.ui)
  const [step, setStep] = useState(0)
  const [role, setRole] = useState<Role>("develop")
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
    markOnboardingDone()
    props.onClose()
  }
  const last = step === BuffFirstRun.STEPS.length - 1
  const current = BuffFirstRun.STEPS[step]
  const counter = t("Step {n} of {total}", { n: step + 1, total: BuffFirstRun.STEPS.length })

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
            {BuffFirstRun.STEPS.map((item, index) => (
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
          {step === 1 && (
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
          {step === 2 && (
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

const pickRole = (value: string): Role => BuffFirstRun.ROLES.find((item) => item.value === value)?.value ?? "develop"
const pickTheme = (value: string): Theme => BuffFirstRun.THEMES.find((item) => item.value === value)?.value ?? "system"

/** Signed in to Buff: the buff integration has a credential (the Solid window's buffSignedIn). */
function useBuffSignedIn(server: Server) {
  const integrations = useServerData(server, () => server.data.location.integration.list())
  useEffect(() => {
    void server.data.location.integration.sync().catch(() => undefined)
  }, [server])
  return !!integrations?.some(
    (integration) =>
      integration.id === "buff" && integration.connections.some((connection) => connection.type === "credential"),
  )
}
