// Notifications (#584), ported from the Solid window's notifications.tsx: system notifications for
// a finished turn, a permission request and an error, and the sound of each (previewed on pick).

import { playSoundById, SOUND_OPTIONS } from "@opencode/app/react-reuse/sound"
import { useEffect, useRef } from "react"
import { useI18n } from "../../i18n/provider"
import { useSettings, useSettingsModel } from "../../shell/settings-context"
import type { Settings } from "../../shell/settings-model"
import { SelectRow, SettingsBody, SettingsHeader, SettingsList, SettingsSection, SwitchRow } from "../kit"

const NONE = "none"
const channels = [
  { kind: "agent", enabled: "agentEnabled", action: "settings-sounds-agent" },
  { kind: "permissions", enabled: "permissionsEnabled", action: "settings-sounds-permissions" },
  { kind: "errors", enabled: "errorsEnabled", action: "settings-sounds-errors" },
] as const

export function SettingsNotifications() {
  const i18n = useI18n()
  const model = useSettingsModel()
  const notifications = useSettings((settings) => settings.notifications)
  const sounds = useSettings((settings) => settings.sounds)
  const preview = useSoundPreview()
  const options = [
    { value: NONE, label: i18n.t("sound.option.none") },
    ...SOUND_OPTIONS.map((option) => ({ value: option.id, label: i18n.t(option.label) })),
  ]
  const pick = (channel: (typeof channels)[number], value: string) => {
    if (value === NONE) {
      model.sounds({ [channel.enabled]: false })
      return preview.stop()
    }
    model.sounds({ [channel.enabled]: true, [channel.kind]: value } satisfies Partial<Settings["sounds"]>)
    preview.play(value)
  }
  return (
    <>
      <SettingsHeader
        title={i18n.t("settings.tab.notifications")}
        description={i18n.t("settings.notifications.description")}
      />
      <SettingsBody sectioned>
        <SettingsSection title={i18n.t("settings.general.section.notifications")}>
          <SettingsList>
            <SwitchRow
              action="settings-notifications-agent"
              title={i18n.t("settings.general.notifications.agent.title")}
              description={i18n.t("settings.general.notifications.agent.description")}
              checked={notifications.agent}
              onChange={(value) => model.notifications({ agent: value })}
            />
            <SwitchRow
              action="settings-notifications-permissions"
              title={i18n.t("settings.general.notifications.permissions.title")}
              description={i18n.t("settings.general.notifications.permissions.description")}
              checked={notifications.permissions}
              onChange={(value) => model.notifications({ permissions: value })}
            />
            <SwitchRow
              action="settings-notifications-errors"
              title={i18n.t("settings.general.notifications.errors.title")}
              description={i18n.t("settings.general.notifications.errors.description")}
              checked={notifications.errors}
              onChange={(value) => model.notifications({ errors: value })}
            />
          </SettingsList>
        </SettingsSection>
        <SettingsSection title={i18n.t("settings.general.section.sounds")}>
          <SettingsList>
            {channels.map((channel) => (
              <SelectRow
                key={channel.kind}
                action={channel.action}
                title={i18n.t(`settings.general.sounds.${channel.kind}.title`)}
                description={i18n.t(`settings.general.sounds.${channel.kind}.description`)}
                value={sounds[channel.enabled] ? sounds[channel.kind] : NONE}
                options={options}
                onHighlight={(value) => preview.play(value === NONE ? undefined : value)}
                onChange={(value) => pick(channel, value)}
              />
            ))}
          </SettingsList>
        </SettingsSection>
      </SettingsBody>
    </>
  )
}

// A short delay before a preview, so moving through the list does not play every sound.
function useSoundPreview() {
  const state = useRef<{ cleanup?: () => void; timeout?: ReturnType<typeof setTimeout>; run: number }>({ run: 0 })
  const stop = () => {
    state.current.run += 1
    state.current.cleanup?.()
    clearTimeout(state.current.timeout)
    state.current.cleanup = undefined
    state.current.timeout = undefined
  }
  const play = (id: string | undefined) => {
    stop()
    if (!id) return
    const run = ++state.current.run
    state.current.timeout = setTimeout(() => {
      state.current.timeout = undefined
      void playSoundById(id).then((cleanup) => {
        if (state.current.run === run) {
          state.current.cleanup = cleanup
          return
        }
        cleanup?.()
      })
    }, 100)
  }
  useEffect(() => stop, [])
  return { play, stop }
}
