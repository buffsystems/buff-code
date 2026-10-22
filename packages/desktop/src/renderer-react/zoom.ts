// The window's zoom (#584), the Solid renderer's window/zoom.ts without its Solid signal: the
// factor lives in the main process (a renderer reload keeps it), Ctrl/Cmd with -, = and 0 step it,
// and a pinch on the trackpad (Ctrl + wheel) zooms when the setting allows it.

import type { ElectronAPI } from "../renderer/api-types"

const MAX_ZOOM_LEVEL = 10
const MIN_ZOOM_LEVEL = 0.2
const WHEEL_PINCH_THRESHOLD = 20
const WHEEL_PINCH_STEP = 0.2
const WHEEL_PINCH_END_DELAY = 160

export const clampZoom = (value: number) => Math.min(Math.max(value, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)

export type WindowZoom = ReturnType<typeof createWindowZoom>

export function createWindowZoom(
  api: Pick<
    ElectronAPI,
    | "getZoomFactor"
    | "setZoomFactor"
    | "onZoomFactorChanged"
    | "getPinchZoomEnabled"
    | "setPinchZoomEnabled"
    | "onPinchZoomEnabledChanged"
  >,
  mac: boolean,
) {
  const state = { shown: 1, requested: 1, pinch: false }
  const wheel: { active: boolean; startZoom: number; totalDelta: number; timeout?: ReturnType<typeof setTimeout> } = {
    active: false,
    startZoom: 1,
    totalDelta: 0,
  }
  const apply = (next: number) => {
    state.requested = next
    void api
      .setZoomFactor(next)
      .then(() => {
        if (state.requested === next) state.shown = next
      })
      .catch(() => {
        if (state.requested === next) state.requested = state.shown
      })
  }
  const resetWheel = () => {
    clearTimeout(wheel.timeout)
    wheel.active = false
    wheel.totalDelta = 0
  }
  void api.getZoomFactor().then((factor) => {
    if (state.requested !== 1) return
    state.requested = state.shown = clampZoom(factor)
  })
  api.onZoomFactorChanged((factor) => {
    state.requested = state.shown = clampZoom(factor)
  })
  void api.getPinchZoomEnabled().then((enabled) => (state.pinch = enabled))
  api.onPinchZoomEnabledChanged((enabled) => {
    state.pinch = enabled
    resetWheel()
  })

  const zoom = {
    factor: () => state.shown,
    reset: () => apply(1),
    in: () => apply(clampZoom(state.requested + 0.2)),
    out: () => apply(clampZoom(state.requested - 0.2)),
    pinchEnabled: () => api.getPinchZoomEnabled(),
    setPinchEnabled(enabled: boolean) {
      state.pinch = enabled
      resetWheel()
      return api.setPinchZoomEnabled(enabled)
    },
  }

  window.addEventListener(
    "wheel",
    (event) => {
      if (!state.pinch || !event.ctrlKey) return
      event.preventDefault()
      clearTimeout(wheel.timeout)
      wheel.timeout = setTimeout(resetWheel, WHEEL_PINCH_END_DELAY)
      if (!wheel.active && wheel.totalDelta === 0) wheel.startZoom = state.requested
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * window.innerHeight
            : event.deltaY
      wheel.totalDelta += delta
      if (!wheel.active && Math.abs(wheel.totalDelta) < WHEEL_PINCH_THRESHOLD) return
      if (!wheel.active) {
        wheel.active = true
        wheel.startZoom = state.requested
        wheel.totalDelta = 0
        return
      }
      apply(clampZoom(wheel.startZoom - (wheel.totalDelta / WHEEL_PINCH_THRESHOLD) * WHEEL_PINCH_STEP))
    },
    { passive: false },
  )
  window.addEventListener("keydown", (event) => {
    if (!(mac ? event.metaKey : event.ctrlKey)) return
    if (event.key === "-") {
      event.preventDefault()
      return zoom.out()
    }
    if (event.key === "=" || event.key === "+") {
      event.preventDefault()
      return zoom.in()
    }
    if (event.key === "0") {
      event.preventDefault()
      zoom.reset()
    }
  })
  return zoom
}
