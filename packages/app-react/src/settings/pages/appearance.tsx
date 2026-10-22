// Appearance (#584): the colour scheme — light, dark or as the system, the only themes the React
// window has (the owner's decision) — the three fonts, the text sizes (#461) and the session tabs'
// layout (#470). Ported from the Solid window's appearance.tsx.

import { Button, useTheme, type Theme } from "@buff/ui/react"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import { useSettings, useSettingsModel } from "../../shell/settings-context"
import { fontDefaults, fontFamily } from "../../shell/settings-model"
import { CODE, codeSize, resetTextSize, setCodeSize, setUiSize, textSize, UI } from "../../buff/text-size"
import { SelectRow, SettingsBody, SettingsHeader, SettingsList, SettingsRow, SettingsSection, TextRow } from "../kit"

const fonts = [
  {
    field: "sans",
    action: "settings-ui-font",
    title: "settings.general.row.uiFont.title",
    description: "settings.general.row.uiFont.description",
  },
  {
    field: "mono",
    action: "settings-code-font",
    title: "settings.general.row.font.title",
    description: "settings.general.row.font.description",
  },
  {
    field: "terminal",
    action: "settings-terminal-font",
    title: "settings.general.row.terminalFont.title",
    description: "settings.general.row.terminalFont.description",
  },
] as const

export function SettingsAppearance() {
  const i18n = useI18n()
  const theme = useTheme()
  const model = useSettingsModel()
  const appearance = useSettings((settings) => settings.appearance)
  const schemes: { value: Theme; label: string }[] = [
    { value: "system", label: i18n.t("theme.scheme.system") },
    { value: "light", label: i18n.t("theme.scheme.light") },
    { value: "dark", label: i18n.t("theme.scheme.dark") },
  ]
  return (
    <>
      <SettingsHeader
        title={i18n.t("settings.general.section.appearance")}
        description={i18n.t("settings.appearance.description")}
      />
      <SettingsBody>
        <SettingsSection>
          <SettingsList>
            <SelectRow
              action="settings-color-scheme"
              title={i18n.t("settings.general.row.colorScheme.title")}
              description={i18n.t("settings.general.row.colorScheme.description")}
              value={theme.theme}
              options={schemes}
              onChange={theme.setTheme}
            />
            {fonts.map((font) => (
              <TextRow
                key={font.field}
                action={font.action}
                title={i18n.t(font.title)}
                description={i18n.t(font.description)}
                value={appearance[font.field]}
                placeholder={fontDefaults[font.field]}
                style={{ fontFamily: fontFamily(font.field, appearance[font.field]) }}
                onChange={(value) => model.setFont(font.field, value)}
              />
            ))}
            <TextSizeRows />
            <SelectRow
              action="settings-tab-layout"
              title={i18n.t("settings.appearance.row.tabs.title")}
              description={i18n.t("settings.appearance.row.tabs.description")}
              value={appearance.tabLayout}
              options={[
                { value: "vertical", label: i18n.t("settings.appearance.row.tabs.vertical") },
                { value: "horizontal", label: i18n.t("settings.appearance.row.tabs.horizontal") },
              ]}
              onChange={(value) => model.appearance({ tabLayout: value })}
            />
          </SettingsList>
        </SettingsSection>
      </SettingsBody>
    </>
  )
}

// The interface and code sizes (#461), each with a sample that changes at once.
function TextSizeRows() {
  const i18n = useI18n()
  const t = i18n.buff.t
  const sizes = useStore(textSize, (value) => value)
  return (
    <>
      <SettingsRow
        title={t("Interface font size")}
        description={t("This is how labels, menus and messages will look.")}
      >
        <SizeSlider
          label={t("Interface font size")}
          value={sizes.ui}
          range={UI}
          action="buff-size-ui"
          onChange={setUiSize}
        />
      </SettingsRow>
      <SettingsRow
        title={t("Code font size")}
        description={<code className="font-mono">const answer = await buff.ask(question)</code>}
      >
        <SizeSlider
          label={t("Code font size")}
          value={codeSize(sizes)}
          range={CODE}
          action="buff-size-code"
          onChange={setCodeSize}
        />
      </SettingsRow>
      <SettingsRow
        title={t("Default sizes")}
        description={t("Files, changes, code blocks in answers and the terminal too.")}
      >
        <Button data-action="buff-size-reset" onClick={resetTextSize}>
          {t("Reset")}
        </Button>
      </SettingsRow>
    </>
  )
}

function SizeSlider(props: {
  label: string
  value: number
  range: { min: number; max: number }
  action: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center gap-2.5">
      <input
        type="range"
        className="w-40 accent-primary"
        min={props.range.min}
        max={props.range.max}
        step={1}
        value={props.value}
        aria-label={props.label}
        data-action={props.action}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
      />
      <span className="ui-hint ui-num min-w-11">{props.value} px</span>
    </div>
  )
}
