// One settings surface per window (#584), kept for the window's life so the page and the search
// survive leaving settings and coming back; created on first use, without an app-wide provider.

import { useCommands } from "../commands/provider"
import type { Core } from "../react/core"
import { useCore } from "../react/core"
import { useStore } from "../react/use-store"
import { useNavigate } from "../router/router"
import { createSettingsSurface, type SettingsSurface, type SettingsSurfaceState } from "./surface"

const surfaces = new WeakMap<Core, SettingsSurface>()

export function useSettingsSurface() {
  const core = useCore()
  const navigate = useNavigate()
  const commands = useCommands()
  const existing = surfaces.get(core)
  if (existing) return existing
  const surface = createSettingsSurface({
    show: () => navigate("/settings"),
    goBack: () => commands.trigger("common.goBack"),
  })
  surfaces.set(core, surface)
  return surface
}

export function useSettingsState<Selected>(select: (state: SettingsSurfaceState) => Selected) {
  return useStore(useSettingsSurface().store, select)
}
