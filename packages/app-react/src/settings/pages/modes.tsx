// Настройки → Модели → «Режимы по умолчанию» (#836, эпик #783): дефолтный режим размышлений и
// потолок контекста новой сессии — ключи `thinking` и `context` глобального конфига сервера,
// читаются через config.get и пишутся через config.update. Слова — те же, что у контролов композера.

import { Input } from "@buff/ui/react"
import type { ConfigEntry } from "@opencode/client/promise"
import { BuffContextWindow } from "@opencode/schema/buff-context-window"
import { BuffVariant } from "@opencode/schema/buff-variant"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { SelectRow, SettingsList, SettingsRow, SettingsSection } from "../kit"
import { useSettingsScope } from "../scope"
import { defaultModes, type DefaultModes } from "./modes-model"

const NONE: DefaultModes = { thinking: "default", context: 0 }

export function DefaultModesSection() {
  const i18n = useI18n()
  const t = i18n.buff.t
  const { server } = useSettingsScope()
  const client = useQueryClient()
  const key = ["default-modes", server.key]
  const state = useQuery({
    queryKey: key,
    queryFn: () =>
      server
        .api()
        .config.get()
        .catch((): ConfigEntry[] => [])
        .then(defaultModes),
  })
  const modes = state.data ?? NONE
  const write = (patch: Partial<DefaultModes>) => {
    const previous = modes
    client.setQueryData(key, { ...modes, ...patch })
    void server
      .api()
      .config.update({
        ...(patch.thinking !== undefined ? { thinking: patch.thinking === "default" ? null : patch.thinking } : {}),
        ...(patch.context !== undefined ? { context: patch.context || null } : {}),
      })
      .catch((error: unknown) => {
        client.setQueryData(key, previous)
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: error instanceof Error ? error.message : i18n.t("common.requestFailed"),
        })
      })
  }
  const [custom, setCustom] = useState(false)
  const contextOptions = BuffContextWindow.options(undefined, modes.context, t)
  return (
    <SettingsSection title={t("Default modes")}>
      <SettingsList>
        <SelectRow
          action="settings-default-thinking"
          title={t(BuffVariant.TITLE)}
          description={`${t("How long the model thinks before answering")}. ${t("For a new session, until it names its own")}.`}
          value={modes.thinking}
          options={BuffVariant.LEVELS.map((id) => ({
            value: id as string,
            label: BuffVariant.label(id, t),
            description: BuffVariant.hint(id, t),
          }))}
          onChange={(value) => write({ thinking: value })}
        />
        <SelectRow
          action="settings-default-context"
          title={t(BuffContextWindow.TITLE)}
          description={`${t("How much of the dialogue the model keeps in mind before compaction")}. ${t("For a new session, until it names its own")}.`}
          value={custom ? BuffContextWindow.CUSTOM : String(modes.context)}
          options={contextOptions.map((option) => ({ value: option.id, label: option.label, description: option.hint }))}
          onChange={(id) => {
            if (id === BuffContextWindow.CUSTOM) return setCustom(true)
            setCustom(false)
            const value = BuffContextWindow.parse(id)
            if (value !== undefined) write({ context: value })
          }}
        />
        {custom && (
          <CustomContextRow
            initial={modes.context}
            onApply={(value) => {
              setCustom(false)
              if (value !== undefined) write({ context: value })
            }}
          />
        )}
      </SettingsList>
    </SettingsSection>
  )
}

/** The custom size typed in tokens (150000, 150k, 1.5M); Enter or leaving the field applies it. */
function CustomContextRow(props: { initial: number; onApply(value: number | undefined): void }) {
  const t = useI18n().buff.t
  const id = useId()
  const [text, setText] = useState(props.initial ? String(props.initial) : "")
  const value = BuffContextWindow.parseCustom(text, undefined)
  return (
    <SettingsRow
      title={<label htmlFor={id}>{t("Own size")}</label>}
      description={t("From {min} to {max}", { min: BuffContextWindow.format(BuffContextWindow.MIN_CUSTOM), max: "∞" })}
    >
      <Input
        id={id}
        className="settings-font-input"
        data-action="settings-default-context-custom"
        inputMode="numeric"
        autoFocus
        value={text}
        placeholder="200000"
        aria-invalid={!!text && value === undefined}
        onChange={(event) => setText(event.currentTarget.value)}
        onBlur={() => props.onApply(value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.onApply(value)
        }}
      />
    </SettingsRow>
  )
}
