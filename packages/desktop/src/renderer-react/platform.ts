// Buff (#561): the desktop host of the React window — the same IPC bridge the Solid renderer uses,
// shaped as the React window's Platform.

import type { BrowserPanePlatform } from "@opencode/app/react-reuse/browser-pane"
import { createDraftStore } from "@opencode/app/react-reuse/drafts"
import { createStore, type Platform, type Updater, type UpdaterState, type WindowChrome } from "@opencode/app-react"
import { createNamespaceStorage, type NamespaceStorage } from "@opencode/app/react-reuse/namespace-storage"
import { DragCancelEvent } from "../shared/ipc-transport"
import type { ElectronAPI } from "../renderer/api-types"
import { onBeforeDispose } from "../renderer/ipc-client"
import { createDesktopFiles } from "../renderer/platform/files"
import { createDesktopNotify } from "../renderer/platform/notifications"
import { clampZoom, type WindowZoom } from "./zoom"

export function createDesktopPlatform(
  api: ElectronAPI,
  version: string,
  input: { zoom: WindowZoom; firstLaunch: () => boolean | undefined },
): Platform {
  const os = desktopOS()
  const files = createDesktopFiles(api, os)
  return {
    platform: "desktop",
    os,
    version,
    windowID: api.getWindowID(),
    openExternal: (url) => api.openExternal(url),
    restart: async () => api.relaunch(),
    notify: createDesktopNotify(api),
    storage: createDesktopStorage(api),
    getDefaultServer: () => api.getDefaultServerUrl().catch(() => null),
    setDefaultServer: (url) => api.setDefaultServerUrl(url),
    // WSL distros are a Windows feature; SSH hosts are tunnelled by the main process everywhere.
    wslServers: os === "windows" ? api.wslServers : undefined,
    sshServers: api.sshServers,
    openDirectoryPickerDialog: (options) =>
      api.openDirectoryPicker({ multiple: options?.multiple ?? false, title: options?.title }),
    browserPane: createBrowserPane(api),
    openPath: files.openPath,
    revealPath: files.revealPath,
    writeClipboardText: files.writeClipboardText,
    // Composer drafts and their images stay in the main process's draft store, where the Solid
    // window kept them: a draft written there before the switch opens here as it was.
    draftStore: createDraftStore({
      get: api.draftGet,
      set: api.draftSet,
      remove: api.draftDelete,
      putBlob: (blob) => blob.arrayBuffer().then(api.draftBlobPut),
      getBlob: (id) => api.draftBlobGet(id).then((data) => data && new Blob([data])),
    }),
    openAttachmentPickerDialog: (options, onFile) =>
      files.openAttachmentPickerDialog({ multiple: options.multiple, defaultPath: options.defaultPath }, onFile),
    getPathForFile: files.getPathForFile,
    readClipboardImage: files.readClipboardImage,
    onDragCancel(callback) {
      window.addEventListener(DragCancelEvent, callback)
      return () => window.removeEventListener(DragCancelEvent, callback)
    },
    webviewZoom: input.zoom.factor,
    getPinchZoomEnabled: input.zoom.pinchEnabled,
    setPinchZoomEnabled: input.zoom.setPinchEnabled,
    updater: createDesktopUpdater(api),
    buffNetwork: api.buffNetwork,
    firstLaunch: input.firstLaunch,
    finishFirstLaunch: (createDefaultProject) => api.finishFirstLaunchOnboarding(createDefaultProject),
    onMenuCommand: (handler) => api.onMenuCommand(handler),
    setNativeTranslations: (bundle) => void api.setNativeTranslations(bundle).catch(() => undefined),
    exportDebugLogs: () => api.exportDebugLogs(),
    recordFatalRendererError: (error) => api.recordFatalRendererError(error),
    setForceFocus: (enabled) => api.setForceFocus(enabled),
    checkAppExists: (appName) => api.checkAppExists(appName),
    windowChrome: createWindowChrome(api),
    // Zoom steps go through the window's zoom (it keeps the requested factor); the rest is the main process's.
    runDesktopMenuAction: (action) => {
      if (action === "view.resetZoom") return input.zoom.reset()
      if (action === "view.zoomIn") return input.zoom.in()
      if (action === "view.zoomOut") return input.zoom.out()
      void api.runDesktopMenuAction(action).catch(() => undefined)
    },
  }
}

// The zoom factor and full screen, as the main process reports them.
function createWindowChrome(api: ElectronAPI) {
  const state = createStore<WindowChrome>({ zoom: 1, fullscreen: false })
  void api.getZoomFactor().then((factor) => state.set((current) => ({ ...current, zoom: clampZoom(factor) })))
  api.onZoomFactorChanged((factor) => state.set((current) => ({ ...current, zoom: clampZoom(factor) })))
  void api.getWindowFullscreen().then((fullscreen) => state.set((current) => ({ ...current, fullscreen })))
  api.onWindowFullscreenChanged((fullscreen) => state.set((current) => ({ ...current, fullscreen })))
  return state
}

// The updater's state from the main process, as a store the update button and settings read.
function createDesktopUpdater(api: ElectronAPI): Updater {
  const state = createStore<UpdaterState>({ status: "disabled" })
  void api.updater.subscribe((next) => state.set(() => next))
  return {
    state,
    check: () => api.updater.check(),
    install: () => api.updater.install(),
  }
}

// The native browser pane over IPC, as the Solid renderer binds it: one binding per registration.
function createBrowserPane(api: ElectronAPI): BrowserPanePlatform {
  return {
    register(target, onEvent) {
      const bindingID = crypto.randomUUID()
      const state = { closed: false }
      const dispose = api.browserPane.onEvent((value) => {
        if (!state.closed && value.bindingID === bindingID) onEvent(value.event)
      })
      const ready = api.browserPane.request({ type: "register", bindingID, target })
      // Failures reach the owner through the closed-state event; keep the bare promise handled.
      void ready.catch(() => undefined)
      return {
        setLayout(layout) {
          if (state.closed) return
          void ready
            .then(() =>
              api.browserPane.send({ type: "layout", bindingID, ...(layout === undefined ? {} : { layout }) }),
            )
            .catch(() => undefined)
        },
        command: (command) => ready.then(() => api.browserPane.request({ type: "command", bindingID, command })),
        close() {
          if (state.closed) return
          state.closed = true
          dispose()
          void ready.then(() => api.browserPane.request({ type: "close", bindingID })).catch(() => undefined)
        },
      }
    },
  }
}

// Namespaces live in the main process's store, as for the Solid renderer, so both windows share them.
function createDesktopStorage(api: ElectronAPI) {
  const namespaces = new Map<string, NamespaceStorage>()
  const driver = { items: api.storeItems, update: api.storeUpdate, clear: api.storeClear }
  const flush = () => Promise.all([...namespaces.values()].map((namespace) => namespace.flush()))
  api.onStoreChanged((name, insert, remove, revision) => namespaces.get(name)?.accept(insert, remove, revision))
  onBeforeDispose(flush)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush()
  })
  return (name: string) => {
    const existing = namespaces.get(name)
    if (existing) return existing
    const created = createNamespaceStorage(driver, name)
    namespaces.set(name, created)
    return created
  }
}

function desktopOS() {
  if (navigator.userAgent.includes("Mac")) return "macos" as const
  if (navigator.userAgent.includes("Windows")) return "windows" as const
  if (navigator.userAgent.includes("Linux")) return "linux" as const
  return undefined
}
