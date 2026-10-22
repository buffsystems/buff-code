// Keyboard shortcuts (#584), ported from the Solid window's keybinds.tsx: every command the window
// has seen, by group, with the keys it has now; a click records new keys, Backspace clears them.
// Buff (#460): keys without a modifier are refused with the reason, taken keys are reassigned only
// after asking, «Find by keys» filters by a pressed combination, resetting all asks first.

import { Button, IconButton, Input } from "@buff/ui/react"
import { catalogTitle } from "@opencode/app/react-reuse/catalog-title"
import { BuffKeybinds } from "@opencode/app/react-reuse/keybind-rules"
import { X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { formatKeybind } from "../../commands/keybind"
import { useCommandCatalog, useCommands } from "../../commands/provider"
import { confirm } from "../../dialog/confirm"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import { showToast } from "../../shell/notifications/toast"
import { useSettings, useSettingsModel } from "../../shell/settings-context"
import { SettingsBody, SettingsHeader, SettingsList, SettingsSection } from "../kit"
import {
  createKeybindCapture,
  DEFAULT_PALETTE_KEYBIND,
  filterKeybinds,
  GROUPS,
  groupKey,
  keybindList,
  PALETTE_ID,
  signatures,
} from "./shortcuts-model"

export function SettingsShortcuts(props: { autofocus: boolean }) {
  const i18n = useI18n()
  const t = i18n.buff.t
  const commands = useCommands()
  const catalog = useCommandCatalog()
  const dialog = useDialog()
  const model = useSettingsModel()
  const overrides = useSettings((settings) => settings.keybinds)
  const changes = useStore(commands.changes, (value) => value)
  const [filter, setFilter] = useState("")
  const field = useRef<HTMLDivElement>(null)

  const list = useMemo(
    () =>
      keybindList({
        catalog,
        options: commands.registered(),
        overrides,
        paletteTitle: i18n.t("command.palette"),
        title: (title) => catalogTitle(title, i18n.locale),
      }),
    [catalog, changes, overrides, i18n],
  )
  const effective = (id: string) => {
    if (id === PALETTE_ID) return overrides[id] ?? DEFAULT_PALETTE_KEYBIND
    const custom = overrides[id]
    if (custom !== undefined) return custom
    return commands.registered().find((option) => option.id === id)?.keybind ?? catalog[id]?.keybind
  }
  const shown = (id: string) => formatKeybind(effective(id) ?? "", i18n.t)
  const used = () => {
    const map = new Map<string, { id: string; title: string }[]>()
    list.forEach((entry, id) =>
      signatures(effective(id)).forEach((signature) =>
        map.set(signature, [...(map.get(signature) ?? []), { id, title: entry.title }]),
      ),
    )
    return map
  }
  const latest = useRef({ used, list })
  latest.current = { used, list }

  const [capture] = useState(() =>
    createKeybindCapture({
      suspend: commands.suspend,
      set: model.keybinds.set,
      used: () => latest.current.used(),
      title: (id) => latest.current.list.get(id)?.title ?? "",
      confirmConflict: (input) =>
        confirm(dialog, {
          title: t("Keys taken"),
          text: i18n.buff.n(
            input.count,
            "{keys} is already used by: {commands}. Reassign to “{title}”? That command will lose it.|{keys} is already used by: {commands}. Reassign to “{title}”? Those commands will lose it.",
            { keys: formatKeybind(input.keys, i18n.t), commands: input.commands.join(", "), title: input.title },
          ),
          action: t("Reassign"),
          cancel: i18n.t("common.cancel"),
        }),
    }),
  )
  const state = useStore(capture.store, (value) => value)
  useEffect(() => {
    document.addEventListener("keydown", capture.handle, { capture: true })
    return () => {
      document.removeEventListener("keydown", capture.handle, { capture: true })
      capture.dispose()
    }
  }, [capture])
  useEffect(() => {
    if (!props.autofocus) return
    const frame = requestAnimationFrame(() => field.current?.querySelector("input")?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [props.autofocus])

  const groups = useMemo(() => {
    const found = filterKeybinds(filter, list, shown)
    const combo = state.comboFilter
    if (!combo) return found
    return new Map(
      [...found].map(([group, ids]) => [group, BuffKeybinds.withCombo(ids, (id) => signatures(effective(id)), combo)]),
    )
  }, [filter, list, state.comboFilter, overrides, catalog])
  const empty = GROUPS.every((group) => !groups.get(group)?.length)
  const hasOverrides = Object.values(overrides).some((value) => typeof value === "string")
  const comboFilter = state.comboFilter ? formatKeybind(state.comboFilter.join(","), i18n.t) : undefined

  const reset = () => {
    capture.stop()
    void confirm(dialog, {
      title: t("Reset all key bindings?"),
      text: t("All the key bindings you set will return to their defaults. This cannot be undone."),
      action: t("Reset"),
      cancel: i18n.t("common.cancel"),
    }).then((yes) => {
      if (!yes) return
      model.keybinds.resetAll()
      showToast({
        title: i18n.t("settings.shortcuts.reset.toast.title"),
        description: i18n.t("settings.shortcuts.reset.toast.description"),
      })
    })
  }

  return (
    <>
      <SettingsHeader
        title={i18n.t("settings.shortcuts.title")}
        description={i18n.t("settings.shortcuts.description")}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              data-action="buff-keybind-search-combo"
              aria-pressed={state.combo || !!comboFilter}
              onClick={() => (comboFilter ? capture.combo.clear() : capture.combo.start())}
            >
              {state.combo
                ? t("Press the keys…")
                : comboFilter
                  ? t("Keys: {keys} ×", { keys: comboFilter })
                  : t("Find by keys")}
            </Button>
            <Button variant="ghost" size="sm" disabled={!hasOverrides} onClick={reset}>
              {i18n.t("settings.shortcuts.reset.button")}
            </Button>
          </div>
        }
      >
        <div ref={field} className="settings-tab-search flex items-center gap-1">
          <Input
            type="search"
            className="flex-1"
            value={filter}
            placeholder={i18n.t("settings.shortcuts.search.placeholder")}
            aria-label={i18n.t("settings.shortcuts.search.placeholder")}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setFilter(event.currentTarget.value)}
          />
          {filter && (
            <IconButton icon={X} size="xs" aria-label={i18n.t("common.clear")} onClick={() => setFilter("")} />
          )}
        </div>
      </SettingsHeader>
      <SettingsBody>
        <div className="settings-shortcuts flex flex-col gap-8">
          {GROUPS.map((group) => {
            const ids = groups.get(group) ?? []
            if (!ids.length) return null
            return (
              <SettingsSection key={group} title={i18n.t(groupKey[group])}>
                <SettingsList>
                  {ids.map((id) => {
                    const problem = state.problem?.id === id ? t(state.problem.text) : undefined
                    const also = BuffKeybinds.alsoOn(used(), signatures(effective(id)), id)
                    return (
                      <div key={id}>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span>{list.get(id)?.title}</span>
                          {problem && (
                            <span className="ui-error" data-slot="buff-keybind-problem">
                              {problem}
                            </span>
                          )}
                          {also.length > 0 && (
                            <span className="ui-hint" data-slot="buff-keybind-also">
                              {t("Also used by:")} {also.join(", ")}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          data-keybind-id={id}
                          className={
                            state.active === id
                              ? "settings-keybind-button settings-keybind-button--active"
                              : "settings-keybind-button"
                          }
                          onClick={() => capture.toggle(id)}
                        >
                          {state.active === id
                            ? i18n.t("settings.shortcuts.pressKeys")
                            : shown(id) || i18n.t("settings.shortcuts.unassigned")}
                        </button>
                      </div>
                    )
                  })}
                </SettingsList>
              </SettingsSection>
            )
          })}
          {filter && empty && (
            <div className="settings-status">
              <span>{i18n.t("settings.shortcuts.search.empty")}</span>
              <span className="text-foreground">&quot;{filter}&quot;</span>
            </div>
          )}
        </div>
      </SettingsBody>
    </>
  )
}
