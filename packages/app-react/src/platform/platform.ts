import type { DraftStore } from "@opencode/app/react-reuse/drafts"
import type { DesktopNativeBundle } from "@opencode/app/i18n/desktop-native"
import type { DesktopMenuAction } from "@opencode/app/desktop-menu"
import type { SshPlatform } from "@opencode/app/ssh"
import type { WslServersPlatform } from "@opencode/app/wsl/types"
import type { Store } from "../core/store"

// What the React window needs from its host (#584): the web page or the Electron renderer. The
// Solid app's Platform (packages/app/src/runtime/platform/platform.tsx) carries Solid accessors;
// this is the same contract with plain values, growing with the screens that need each part.

import type { BrowserPanePlatform } from "@opencode/app/react-reuse/browser-pane"

export type PlatformStorage = {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): unknown
  removeItem(key: string): unknown
}

export type UpdaterState =
  | { status: "disabled" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading"; version: string }
  | { status: "ready"; version: string }
  | { status: "download-required"; version: string }
  | { status: "up-to-date" }
  | { status: "installing"; version: string }
  | { status: "error"; message: string }

/** The desktop app's updater; the web has none. */
export type Updater = {
  state: Store<UpdaterState>
  check(): Promise<UpdaterState>
  install(): Promise<void>
}

/** The storage namespace for keys kept outside any namespace (the Solid window's settings.v3). */
export const DEFAULT_STORAGE = "default.dat"

export type Platform = {
  platform: "web" | "desktop"
  os?: "macos" | "windows" | "linux"
  /** App version */
  version?: string
  /** Stable window identity for window-scoped persistence (desktop) */
  windowID?: string
  /** Open a web or mail URL in the default system application */
  openExternal(url: string): void
  restart(): Promise<void>
  notify(title: string, description?: string, onClick?: () => void): Promise<void>
  /** A named persistence namespace; the web keeps it in localStorage under `${name}:${key}`. */
  storage(name: string): PlatformStorage
  /** Fetch override (desktop: the sidecar's credentials are added by the main process) */
  fetch?: typeof globalThis.fetch
  getDefaultServer?(): Promise<string | null>
  setDefaultServer?(url: string | null): Promise<void> | void
  updater?: Updater
  /** The desktop's native browser pane; absent on the web. */
  browserPane?: BrowserPanePlatform
  /** The desktop webview's zoom factor, for placing native views over the page. */
  webviewZoom?(): number
  openDirectoryPickerDialog?(options?: { title?: string; multiple?: boolean }): Promise<string | string[] | null>
  /** Composer drafts and prompt history with their images (web: IndexedDB; desktop: the main process). */
  draftStore?: DraftStore
  /** A native attachment picker that reads the chosen files one by one (desktop only); the web uses a file input. */
  openAttachmentPickerDialog?(
    options: { defaultPath?: string; multiple?: boolean; accept?: string[] },
    onFile: (file: File) => Promise<unknown>,
  ): Promise<void>
  /** The native source path of a dropped or picked file (desktop only). */
  getPathForFile?(file: File): string
  /** Native drag cancellation that never reaches the page (desktop only). */
  onDragCancel?(callback: () => void): () => void
  /** Open a path in the system's file manager, or with `app` (desktop only). */
  openPath?(path: string, app?: string): Promise<void>
  /** Show a file selected in the system's file manager; false when it could not (desktop only). */
  revealPath?(path: string): Promise<boolean>
  /** Put text on the system clipboard (desktop only); the web uses the page's clipboard. */
  writeClipboardText?(text: string): Promise<void>
  /** An image on the system clipboard (desktop only). */
  readClipboardImage?(): Promise<File | null>
  /** WSL servers managed by the desktop app (Windows) */
  wslServers?: WslServersPlatform
  /** SSH servers the desktop app tunnels to */
  sshServers?: SshPlatform
  /** Native pinch/Ctrl-scroll zoom gestures (desktop only) */
  getPinchZoomEnabled?(): Promise<boolean> | boolean
  setPinchZoomEnabled?(enabled: boolean): Promise<void> | void
  /** Buff (#457): whether this is the app's first launch; undefined — not known yet, or not the desktop. */
  firstLaunch?(): boolean | undefined
  /** Buff (#461): the proxy, its exceptions and the organization's certificate (desktop only). */
  buffNetwork?: BuffNetworkPlatform
  /** Commands chosen in the native application menu (desktop only); returns the unsubscribe. */
  onMenuCommand?(handler: (id: string) => void): () => void
  /**
   * Close the first launch (desktop only): with `createDefaultProject` the main process makes the
   * «Default Project» folder and resolves its path, else null; it answers once per install.
   */
  finishFirstLaunch?(createDefaultProject: boolean): Promise<string | null>
  /** The native menu's and dialogs' strings in the window's language (desktop only). */
  setNativeTranslations?(bundle: DesktopNativeBundle): void
  /** Save the app's logs to a file the person chooses; resolves its path (desktop only). */
  exportDebugLogs?(): Promise<string>
  /** Write a fatal renderer error into the app's log, for the logs exported after it (desktop only). */
  recordFatalRendererError?(error: FatalRendererErrorLog): Promise<void>
  /** Keep :focus and :focus-visible forced on every focusable element, for styling (desktop only). */
  setForceFocus?(enabled: boolean): Promise<void>
  /** Whether an app the «Open in» menu offers is installed (desktop only). */
  checkAppExists?(appName: string): Promise<boolean>
  /** The window's zoom and full screen, which size the titlebar around the native controls (desktop only). */
  windowChrome?: Store<WindowChrome>
  /** An application menu action from the in-window menu of Windows and Linux (desktop only). */
  runDesktopMenuAction?(action: DesktopMenuAction): void
}

export type WindowChrome = { zoom: number; fullscreen: boolean }

/** A fatal renderer error as the app's log keeps it. */
export type FatalRendererErrorLog = {
  error: string
  url: string
  version?: string
  platform: "web" | "desktop"
  os?: "macos" | "windows" | "linux"
}

export type BuffNetworkSettings = {
  proxy: string
  noProxy: string
  caFile: string
  username: string
  hasPassword: boolean
  canEncrypt: boolean
}

export type BuffNetworkPlatform = {
  get(): Promise<BuffNetworkSettings>
  /** Resolves a problem to show, or null when saved. */
  set(input: {
    proxy: string
    noProxy: string
    caFile: string
    username: string
    password?: string
  }): Promise<string | null>
  pickCertificate(): Promise<string | null>
}
