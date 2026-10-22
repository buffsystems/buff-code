import { createContext, use, useEffect, useState, type ReactNode } from "react"
import { derive } from "../core/store"
import type { PlatformStorage } from "../platform/platform"
import { applyTextSize } from "../buff/text-size"
import { useStore } from "../react/use-store"
import { shellSettings, type ShellSettings } from "./settings"
import { fontFamily, windowSettings, type Settings, type SettingsModel } from "./settings-model"

type Cell = { model: SettingsModel; store: ReturnType<typeof derive<Settings, ShellSettings>> }
const ShellSettingsContext = createContext<Cell | undefined>(undefined)

export function ShellSettingsProvider(props: { storage: (name: string) => PlatformStorage; children?: ReactNode }) {
  const [cell] = useState<Cell>(() => {
    const model = windowSettings(props.storage)
    applyTextSize()
    return { model, store: derive(model.store, shellSettings) }
  })
  useAppliedFonts(cell.model)
  return <ShellSettingsContext value={cell}>{props.children}</ShellSettingsContext>
}

export function useShellSettingsCell() {
  const cell = use(ShellSettingsContext)
  if (!cell) throw new Error("useShellSettings must be used inside ShellSettingsProvider")
  return cell
}

export function useShellSettings<Selected>(select: (settings: ShellSettings) => Selected) {
  return useStore(useShellSettingsCell().store, select)
}

/** The whole settings model with its setters (the settings screen, the composer, the timeline). */
export function useSettingsModel() {
  return useShellSettingsCell().model
}

/** A slice of the window's settings. */
export function useSettings<Selected>(select: (settings: Settings) => Selected) {
  return useStore(useSettingsModel().store, select)
}

// The chosen faces reach every surface through the root's font variables, as in the Solid window.
function useAppliedFonts(model: SettingsModel) {
  const sans = useStore(model.store, (settings) => settings.appearance.sans)
  const mono = useStore(model.store, (settings) => settings.appearance.mono)
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--font-family-sans", fontFamily("sans", sans))
    root.style.setProperty("--font-family-mono", fontFamily("mono", mono))
    // @buff/ui's own font tokens follow the same choice.
    root.style.setProperty("--font-sans", fontFamily("sans", sans))
    root.style.setProperty("--font-mono", fontFamily("mono", mono))
    void document.fonts?.load(`440 13px ${fontFamily("mono", mono)}`).catch(() => undefined)
  }, [sans, mono])
}
