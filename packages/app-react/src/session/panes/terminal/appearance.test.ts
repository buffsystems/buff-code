import { expect, test } from "bun:test"
import { DEFAULT_SETTINGS, fontFamily, readSettings } from "../../../shell/settings-model"
import { terminalColors, terminalText, withAlpha } from "./appearance"

test("colours follow the card and foreground tokens, with fallbacks per mode", () => {
  const tokens: Record<string, string> = { "--card": " #10131a", "--foreground": "#edeef2" }
  expect(terminalColors("dark", (name) => tokens[name] ?? "")).toEqual({
    background: "#10131a",
    foreground: "#edeef2",
    cursor: "#edeef2",
    selectionBackground: "rgba(237, 238, 242, 0.25)",
  })
  expect(terminalColors("light", () => "").background).toBe("#fcfcfc")
})

test("withAlpha expands short hex and passes other colours", () => {
  expect(withAlpha("#fff", 0.2)).toBe("rgba(255, 255, 255, 0.2)")
  expect(withAlpha("rgb(1, 2, 3)", 0.2)).toBe("rgb(1, 2, 3)")
})

test("font and size come from the settings model and the text sizes", () => {
  const face = readSettings(JSON.stringify({ appearance: { terminal: "Fira Code" } })).appearance.terminal
  expect(terminalText(face, { ui: 14, code: 18 })).toEqual({
    fontFamily: fontFamily("terminal", "Fira Code"),
    fontSize: 18,
  })
  expect(terminalText(face, { ui: 14, code: 18 }).fontFamily.startsWith('"Fira Code", "JetBrainsMono')).toBe(true)
  const defaults = terminalText(DEFAULT_SETTINGS.appearance.terminal, { ui: 14, code: undefined })
  expect(defaults.fontSize).toBe(14)
  expect(defaults.fontFamily.startsWith('"JetBrainsMono')).toBe(true)
})
