import { expect, test } from "bun:test"
import { DEFAULT_SHELL_SETTINGS, readShellSettings } from "./settings"

test("reads the shell's preferences from the Solid window's settings", () => {
  const settings = readShellSettings(
    JSON.stringify({
      appearance: { tabLayout: "horizontal", showProjectName: true, fontSize: 14 },
      general: { mobileTitlebarPosition: "bottom", showStatus: true },
      keybinds: { "tab.new": "ctrl+shift+n" },
    }),
  )
  expect(settings).toEqual({
    tabLayout: "horizontal",
    showProjectName: true,
    mobileTitlebarPosition: "bottom",
    autoApprove: false,
    notifyAgent: true,
    notifyErrors: false,
    keybinds: { "tab.new": "ctrl+shift+n" },
  })
})

test("missing or malformed settings keep the defaults", () => {
  expect(readShellSettings("{}")).toEqual(DEFAULT_SHELL_SETTINGS)
  expect(readShellSettings("not json")).toEqual(DEFAULT_SHELL_SETTINGS)
})
