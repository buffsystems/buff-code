import { makeEventListener } from "@solid-primitives/event-listener"
import { useDialog } from "@opencode/ui/context/dialog"
import { useCommand } from "@/shell/commands/command"
import { useSettingsSurface } from "@/settings/surface"
import { useBuffText } from "@/buff/i18n"

/**
 * Esc из настроек (#460) — и когда фокус ушёл с экрана настроек (щелчок по пустому месту): у
 * экрана свой Esc, но он слышит клавиши только с фокусом внутри. Логика та же: сначала поиск,
 * потом шаг назад. То, что открыто поверх, и запись сочетания забирают Esc раньше.
 */
export function useSettingsEscape(): void {
  const surface = useSettingsSurface()
  const dialog = useDialog()
  const command = useCommand()
  const { t } = useBuffText()
  // Ctrl+, открывает настройки с экранов сессии и главной; здесь то же сочетание их закрывает.
  command.register("buff.settings.close", () => [
    {
      id: "settings.open",
      title: t("Close settings"),
      keybind: "mod+comma",
      hidden: true,
      onSelect: () => surface.close(),
    },
  ])
  makeEventListener(window, "keydown", (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || !surface.active()) return
    if (dialog.active || document.querySelector('[role="listbox"], [role="menu"], [role="dialog"]')) return
    if (surface.search.state.query.trim()) return surface.search.clear()
    surface.back()
  })
}
