// The desktop window's own controls around the titlebar (#584), as the Solid titlebar measures them:
// macOS draws its traffic lights over the page's top left, Windows its caption buttons over the top
// right (the titlebar overlay). Both stay the same physical size while the page zooms.

import { createStore } from "../../core/store"
import { usePlatform } from "../../platform/context"
import type { WindowChrome } from "../../platform/platform"
import { useStore } from "../../react/use-store"

const TITLEBAR_HEIGHT = 36
/** Includes the content inset; matches the native Windows overlay. */
const WINDOWS_TITLEBAR_HEIGHT = 44
const MIN_TITLEBAR_ZOOM = 0.25
/** Three native Windows caption buttons, 46px each. */
const WINDOWS_CONTROLS_WIDTH = 138
/** The traffic lights: a 14px inset, two 20px button pitches and a 14px button. */
const MAC_TRAFFIC_LIGHTS_WIDTH = 68
const MAC_TRAFFIC_LIGHTS_CLEARANCE = 28

const browser = createStore<WindowChrome>({ zoom: 1, fullscreen: false })

export function useDesktopChrome() {
  const platform = usePlatform()
  const chrome = useStore(platform.windowChrome ?? browser, (value) => value)
  const os = platform.platform === "desktop" ? platform.os : undefined
  return {
    mac: os === "macos",
    windows: os === "windows",
    linux: os === "linux",
    desktop: platform.platform === "desktop",
    zoom: chrome.zoom,
    fullscreen: chrome.fullscreen,
  }
}

export type DesktopChrome = ReturnType<typeof useDesktopChrome>

/** The titlebar's box: room for the traffic lights or the caption buttons, at any zoom. */
export function titlebarStyle(chrome: DesktopChrome) {
  if (chrome.mac)
    return {
      minHeight: `${TITLEBAR_HEIGHT / chrome.zoom}px`,
      paddingLeft: chrome.fullscreen ? 0 : `${MAC_TRAFFIC_LIGHTS_WIDTH / chrome.zoom}px`,
    }
  if (!chrome.windows) return undefined
  const zoom = Math.max(chrome.zoom, MIN_TITLEBAR_ZOOM)
  const width = `env(titlebar-area-width, calc(100vw - ${WINDOWS_CONTROLS_WIDTH / Math.max(zoom, 1)}px))`
  return {
    minHeight: `env(titlebar-area-height, ${WINDOWS_TITLEBAR_HEIGHT / Math.min(zoom, 1)}px)`,
    width,
    maxWidth: width,
    // The caption buttons stay on the physical right in both writing directions.
    marginRight: "auto",
  }
}

/** The vertical sidebar's top on macOS: a draggable strip the traffic lights sit in. */
export function macClearance(chrome: DesktopChrome) {
  return chrome.mac ? MAC_TRAFFIC_LIGHTS_CLEARANCE / chrome.zoom : undefined
}
