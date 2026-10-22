// Preferences (#584), ported from the Solid window's general.tsx: language, the default workspace,
// auto-approval, custom agents, the terminal's place, follow-ups, pinch zoom and diff wrapping; the
// network (#461), getting to know Buff Code again (#457), the timeline detail and updates.

import { Button } from "@buff/ui/react"
import { DESKTOP_NATIVE_LABELS } from "@opencode/app/i18n/desktop-native"
import { OFFERED_LOCALES } from "@opencode/app/react-reuse/locales"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { formatKeybind } from "../../commands/keybind"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useMobile } from "../../shell/media"
import { useSettings, useSettingsModel } from "../../shell/settings-context"
import { updaterAction } from "../../shell/updates/updater"
import { useUpdaterCheck, useUpdaterInstall, useUpdaterState } from "../../shell/updates/update-button"
import { BuffOnboardingSettingsRow } from "../../buff/onboarding/settings-row"
import { SettingsBody, SettingsHeader, SettingsList, SettingsRow, SettingsSection, SelectRow, SwitchRow } from "../kit"
import { NetworkSettings } from "./network"
import { TimelineDetailControl } from "./timeline-detail"

export function SettingsGeneral() {
  const i18n = useI18n()
  const platform = usePlatform()
  const desktop = platform.platform === "desktop"
  return (
    <>
      <SettingsHeader
        title={i18n.t("settings.tab.preferences")}
        description={i18n.t("settings.preferences.description")}
      />
      <SettingsBody sectioned>
        <GeneralSection />
        <NetworkSettings />
        <SettingsSection label={i18n.buff.t("Getting to know Buff Code")}>
          <SettingsList>
            <BuffOnboardingSettingsRow />
          </SettingsList>
        </SettingsSection>
        <TimelineSection />
        {desktop && <UpdatesSection />}
      </SettingsBody>
    </>
  )
}

function GeneralSection() {
  const i18n = useI18n()
  const platform = usePlatform()
  const model = useSettingsModel()
  const mobile = useMobile()
  const general = useSettings((settings) => settings.general)
  const destination = useSettings((settings) => settings.workspaces.defaultDestination)
  const autoApprove = useSettings((settings) => settings.permissions.autoApprove)
  return (
    <SettingsSection title={i18n.t("settings.general.section.general")}>
      <SettingsList>
        <SelectRow
          action="settings-language"
          title={i18n.t("settings.general.row.language.title")}
          description={i18n.t("settings.general.row.language.description")}
          value={i18n.locale}
          options={OFFERED_LOCALES.map((locale) => ({ value: locale, label: DESKTOP_NATIVE_LABELS[locale] }))}
          onChange={i18n.setLocale}
        />
        <SelectRow
          action="settings-workspace-destination"
          title={i18n.t("settings.workspaces.default.title")}
          description={i18n.t("settings.workspaces.default.description")}
          value={destination}
          options={[
            { value: "last-used", label: i18n.t("settings.workspaces.default.lastUsed") },
            { value: "local", label: i18n.t("settings.workspaces.default.local") },
            { value: "new", label: i18n.t("settings.workspaces.default.new") },
          ]}
          onChange={(value) => model.workspaces({ defaultDestination: value })}
        />
        <SwitchRow
          action="settings-auto-accept-permissions"
          title={i18n.t("command.permissions.autoaccept.enable")}
          description={i18n.t("toast.permissions.autoaccept.on.description")}
          checked={autoApprove}
          onChange={(value) => model.permissions({ autoApprove: value })}
        />
        <SwitchRow
          action="settings-show-custom-agents"
          title={i18n.t("settings.general.row.showCustomAgents.title")}
          description={i18n.t("settings.general.row.showCustomAgents.description")}
          checked={general.showCustomAgents}
          onChange={(value) => model.general({ showCustomAgents: value })}
        />
        <SelectRow
          action="settings-terminal-placement"
          title={i18n.t("settings.general.row.terminalPlacement.title")}
          description={i18n.t("settings.general.row.terminalPlacement.description")}
          value={general.terminalPlacement}
          options={[
            { value: "side", label: i18n.t("settings.general.row.terminalPlacement.side") },
            { value: "bottom", label: i18n.t("settings.general.row.terminalPlacement.bottom") },
          ]}
          onChange={(value) => model.general({ terminalPlacement: value })}
        />
        <SelectRow
          action="settings-follow-up-behavior"
          title={i18n.t("settings.general.row.followUpBehavior.title")}
          description={i18n.t("settings.general.row.followUpBehavior.description", {
            keybind: formatKeybind("mod+enter", i18n.t),
          })}
          value={general.followUpBehavior}
          options={[
            { value: "queue", label: i18n.t("settings.general.row.followUpBehavior.queue") },
            { value: "steer", label: i18n.t("settings.general.row.followUpBehavior.steer") },
          ]}
          onChange={(value) => model.general({ followUpBehavior: value })}
        />
        {platform.platform === "desktop" && <PinchZoomRow />}
        <SwitchRow
          action="settings-mobile-diff-wrap"
          title={i18n.t("session.review.wrapLines")}
          description={i18n.t("settings.general.row.mobileDiffWrap.description")}
          checked={general.mobileDiffWrap}
          onChange={(value) => model.general({ mobileDiffWrap: value })}
        />
        {mobile && import.meta.env.VITE_OPENCODE_CHANNEL !== "prod" && (
          <SwitchRow
            action="settings-mobile-titlebar-bottom"
            title={i18n.t("settings.general.row.mobileTitlebarBottom.title")}
            description={i18n.t("settings.general.row.mobileTitlebarBottom.description")}
            checked={general.mobileTitlebarPosition === "bottom"}
            onChange={(value) => model.general({ mobileTitlebarPosition: value ? "bottom" : "top" })}
          />
        )}
      </SettingsList>
    </SettingsSection>
  )
}

function PinchZoomRow() {
  const i18n = useI18n()
  const platform = usePlatform()
  const stored = useQuery({
    queryKey: ["settings-pinch-zoom"],
    queryFn: () => Promise.resolve(platform.getPinchZoomEnabled?.() ?? false).catch(() => false),
  })
  const [local, setLocal] = useState<boolean>()
  const checked = local ?? stored.data ?? false
  const change = (value: boolean) => {
    setLocal(value)
    const update = platform.setPinchZoomEnabled?.(value)
    if (update) void update.catch(() => setLocal(!value))
  }
  return (
    <SwitchRow
      action="settings-pinch-zoom"
      title={i18n.t("settings.general.row.pinchZoom.title")}
      description={i18n.t("settings.general.row.pinchZoom.description")}
      checked={checked}
      onChange={change}
    />
  )
}

function TimelineSection() {
  const i18n = useI18n()
  const model = useSettingsModel()
  const detail = useSettings((settings) => settings.general.timelineDetail)
  return (
    <SettingsSection title={i18n.t("settings.timeline.title")} label={i18n.t("settings.timeline.title")}>
      <SettingsList>
        <div className="py-5">
          <TimelineDetailControl value={detail} onChange={model.setTimelineDetail} />
        </div>
      </SettingsList>
    </SettingsSection>
  )
}

function UpdatesSection() {
  const i18n = useI18n()
  const model = useSettingsModel()
  const releaseNotes = useSettings((settings) => settings.general.releaseNotes)
  const state = useUpdaterState()
  const install = useUpdaterInstall()
  const action = updaterAction(state)
  const check = useUpdaterCheck()
  const run = () => {
    if (action.run === "install") return install()
    if (action.run === "check") void check()
  }
  return (
    <SettingsSection title={i18n.t("settings.general.section.updates")}>
      <SettingsList>
        <SwitchRow
          action="settings-release-notes"
          title={i18n.t("settings.general.row.releaseNotes.title")}
          description={i18n.t("settings.general.row.releaseNotes.description")}
          checked={releaseNotes}
          onChange={(value) => model.general({ releaseNotes: value })}
        />
        <SettingsRow
          title={i18n.t("settings.updates.row.check.title")}
          description={i18n.t("settings.updates.row.check.description")}
        >
          <Button data-action="settings-check-updates" disabled={!action.run} onClick={run}>
            {i18n.t(action.label)}
          </Button>
        </SettingsRow>
      </SettingsList>
    </SettingsSection>
  )
}
