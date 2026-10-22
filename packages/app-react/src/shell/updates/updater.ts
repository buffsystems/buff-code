// What the updater offers now (#584), ported from the Solid window's updaterAction.

import type { UpdaterState } from "../../platform/platform"

export function updaterAction(state: UpdaterState | undefined) {
  if (!state) return { label: "settings.updates.action.checkNow" as const }
  switch (state.status) {
    case "checking":
      return { label: "settings.updates.action.checking" as const }
    case "downloading":
      return { label: "settings.updates.action.downloading" as const }
    case "ready":
      return { label: "toast.update.action.installRestart" as const, run: "install" as const }
    case "download-required":
      return { label: "settings.updates.action.download" as const, run: "install" as const }
    case "installing":
      return { label: "settings.updates.action.installing" as const }
    case "disabled":
      return { label: "settings.updates.action.checkNow" as const }
    default:
      return { label: "settings.updates.action.checkNow" as const, run: "check" as const }
  }
}

/** The titlebar's update notice: shown once an update is ready to install, or while installing. */
export function updateNotice(state: UpdaterState | undefined) {
  const installing = state?.status === "installing"
  const version = state?.status === "ready" || state?.status === "download-required" ? state.version : undefined
  return { visible: version !== undefined || installing, installing, version }
}
