// The preferences the shell follows (#584): tab layout, project names on vertical tabs, the phone
// titlebar's place, keybind overrides, auto-approval and notifications — a view over the window's
// settings model (./settings-model), which the settings screen writes.

import { readSettings, type Settings } from "./settings-model"

export type ShellSettings = {
  tabLayout: "horizontal" | "vertical"
  showProjectName: boolean
  mobileTitlebarPosition: "top" | "bottom"
  autoApprove: boolean
  notifyAgent: boolean
  notifyErrors: boolean
  keybinds: Record<string, string>
}

/** The shell's slice of the settings. */
export function shellSettings(settings: Settings): ShellSettings {
  return {
    tabLayout: settings.appearance.tabLayout,
    showProjectName: settings.appearance.showProjectName,
    mobileTitlebarPosition: settings.general.mobileTitlebarPosition,
    autoApprove: settings.permissions.autoApprove,
    notifyAgent: settings.notifications.agent,
    notifyErrors: settings.notifications.errors,
    keybinds: settings.keybinds,
  }
}

export const DEFAULT_SHELL_SETTINGS: ShellSettings = shellSettings(readSettings("{}"))

/** The shell's view of stored settings; anything missing or malformed keeps its default. */
export function readShellSettings(raw: string): ShellSettings {
  return shellSettings(readSettings(raw))
}
