// Experimental (#584), ported from the Solid window's experimental.tsx: project names on the tabs
// and, outside production builds, project icons.

import { useI18n } from "../../i18n/provider"
import { useSettings, useSettingsModel } from "../../shell/settings-context"
import { SettingsBody, SettingsHeader, SettingsList, SettingsSection, SwitchRow } from "../kit"

export function SettingsExperimental() {
  const i18n = useI18n()
  const model = useSettingsModel()
  const showProjectName = useSettings((settings) => settings.appearance.showProjectName)
  const showProjectIcon = useSettings((settings) => settings.general.showProjectIcon)
  return (
    <>
      <SettingsHeader
        title={i18n.t("settings.tab.experimental")}
        description={i18n.t("settings.experimental.description")}
      />
      <SettingsBody>
        <SettingsSection>
          <SettingsList>
            <SwitchRow
              action="settings-show-project-name"
              title={i18n.t("settings.appearance.row.projectName.title")}
              description={i18n.t("settings.appearance.row.projectName.description")}
              checked={showProjectName}
              onChange={(value) => model.appearance({ showProjectName: value })}
            />
            {import.meta.env.VITE_OPENCODE_CHANNEL !== "prod" && (
              <SwitchRow
                action="settings-show-project-icon"
                title={i18n.t("settings.general.row.showProjectIcon.title")}
                description={i18n.t("settings.general.row.showProjectIcon.description")}
                checked={showProjectIcon}
                onChange={(value) => model.general({ showProjectIcon: value })}
              />
            )}
          </SettingsList>
        </SettingsSection>
      </SettingsBody>
    </>
  )
}
