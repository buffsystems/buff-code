// How a terminal looks (#584): colours from the design system's tokens in the painted mode (light or
// dark only — the window has no other themes), and the font and size the window's settings keep
// (the settings model's terminal face, the Buff code size).

import { terminalSize, type TextSizes } from "../../../buff/text-size"
import { fontFamily } from "../../../shell/settings-model"

export type TerminalColors = { background: string; foreground: string; cursor: string; selectionBackground: string }
export type TerminalMode = "light" | "dark"

const FALLBACK: Record<TerminalMode, { background: string; foreground: string }> = {
  light: { background: "#fcfcfc", foreground: "#211e1e" },
  dark: { background: "#191515", foreground: "#d4d4d4" },
}

/** `#rrggbb` (or `#rgb`) with an alpha, as rgba(); other colours pass through. */
export function withAlpha(color: string, alpha: number) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1]
  if (!hex) return color
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex
  const channel = (index: number) => parseInt(full.slice(index, index + 2), 16)
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`
}

/** The terminal's colours: the card surface and the foreground token of the painted mode. */
export function terminalColors(mode: TerminalMode, token: (name: string) => string): TerminalColors {
  const background = token("--card").trim() || FALLBACK[mode].background
  const foreground = token("--foreground").trim() || FALLBACK[mode].foreground
  return {
    background,
    foreground,
    cursor: foreground,
    selectionBackground: withAlpha(foreground, mode === "dark" ? 0.25 : 0.2),
  }
}

export function paintedMode(): TerminalMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export function readTokens(): (name: string) => string {
  const style = getComputedStyle(document.documentElement)
  return (name) => style.getPropertyValue(name)
}

/** The person's terminal face over the Buff stack, and the code size (#461) when one is set. */
export function terminalText(face: string, sizes: TextSizes) {
  return { fontFamily: fontFamily("terminal", face), fontSize: terminalSize(sizes) }
}
