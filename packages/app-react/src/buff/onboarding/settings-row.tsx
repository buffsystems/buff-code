// The row in Preferences that goes through getting to know Buff Code again (#457); the
// introduction itself registers the command it runs.

import { Button } from "@buff/ui/react"
import { useCommands } from "../../commands/provider"
import { useI18n } from "../../i18n/provider"
import { SettingsRow } from "../../settings/kit"

export const ONBOARDING_COMMAND = "buff.onboarding.show"

export function BuffOnboardingSettingsRow() {
  const i18n = useI18n()
  const commands = useCommands()
  const t = i18n.buff.t
  return (
    <SettingsRow
      title={t("Getting to know Buff Code")}
      description={t(
        "Five short steps: what you do, how a chat and the window look, memory and the hooks check, self-setup. Shortcut — Ctrl+Shift+H.",
      )}
    >
      <Button data-action="buff-onboarding-again" onClick={() => commands.trigger(ONBOARDING_COMMAND)}>
        {t("Go through again")}
      </Button>
    </SettingsRow>
  )
}
