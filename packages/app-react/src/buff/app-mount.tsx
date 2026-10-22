// Buff's window-wide pieces: getting to know Buff Code (#457) on the first launch and by its
// command, and the window's language told to the Buff service (#472).

import { BuffLocale } from "@opencode/schema/buff-locale"
import { useEffect, useRef } from "react"
import { useCommandRegistration } from "../commands/provider"
import type { Server } from "../core/servers"
import { useDialog } from "../dialog/dialogs"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { useConnection } from "../react/core"
import type { AppMount } from "../shell/mounts"
import { OnboardingDialog } from "./onboarding/dialog"
import { ONBOARDING_COMMAND } from "./onboarding/settings-row"
import { firstLaunchDecision, markOnboardingDone, onboardingDone, onboardingPending } from "./onboarding/state"
import { WithFirstServer } from "./page"

function Onboarding(props: { server: Server }) {
  const dialog = useDialog()
  const platform = usePlatform()
  const i18n = useI18n()
  const show = () => {
    onboardingPending.set(() => true)
    dialog.show((close) => (
      <OnboardingDialog
        server={props.server}
        onClose={() => {
          close()
          onboardingPending.set(() => !onboardingDone())
        }}
      />
    ))
  }
  useCommandRegistration("buff.onboarding", () => [
    {
      id: ONBOARDING_COMMAND,
      title: i18n.buff.t("Show the Buff Code introduction"),
      category: "Buff",
      keybind: "mod+shift+h",
      onSelect: show,
    },
  ])
  // Only on the first launch: for those who already worked, the introduction does not open itself.
  const latest = useRef(show)
  latest.current = show
  const decided = useRef(false)
  useEffect(() => {
    const firstLaunch = platform.firstLaunch
    // Not the desktop: the first launch is unknown — the introduction only by command.
    if (!firstLaunch) return void onboardingPending.set(() => false)
    // The desktop learns about the first launch a moment after start: ask until it knows.
    const decide = () => {
      if (decided.current) return true
      const decision = firstLaunchDecision(firstLaunch(), onboardingDone())
      if (decision === "wait") return false
      decided.current = true
      if (decision === "show") latest.current()
      if (decision === "skip") markOnboardingDone()
      return true
    }
    if (decide()) return
    const timer = setInterval(() => decide() && clearInterval(timer), 250)
    return () => clearInterval(timer)
  }, [platform])
  return null
}

function LocaleSync(props: { server: Server }) {
  const i18n = useI18n()
  const connection = useConnection(props.server)
  useEffect(() => {
    if (connection.status !== "connected") return
    void props.server
      .api()
      .rpc(BuffLocale.Rpc)
      .set(i18n.locale)
      .catch(() => undefined)
  }, [i18n.locale, connection.status, props.server])
  return null
}

export default [
  {
    id: "buff-onboarding",
    component: () => <WithFirstServer>{(server) => <Onboarding server={server} />}</WithFirstServer>,
  },
  {
    id: "buff-locale-sync",
    component: () => <WithFirstServer>{(server) => <LocaleSync server={server} />}</WithFirstServer>,
  },
] satisfies AppMount[]
