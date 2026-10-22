import { createBrowserDraftStore } from "@opencode/app/react-reuse/drafts"
import { DEFAULT_STORAGE, type Platform, type PlatformStorage } from "./platform"

type SyncStorage = {
  [Method in keyof PlatformStorage]: (
    ...args: Parameters<PlatformStorage[Method]>
  ) => Awaited<ReturnType<PlatformStorage[Method]>>
}

const settings = () => localStorageNamespace("opencode.settings.dat")

/** The browser host, ported from the Solid app's createWebPlatform. */
export function createWebPlatform(version: string) {
  const currentServerUrl = currentServer()
  const platform: Platform = {
    platform: "web",
    version,
    openExternal(value) {
      if (!URL.canParse(value)) return
      const url = new URL(value)
      if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return
      window.open(url.href, "_blank", "noopener,noreferrer")
    },
    restart: async () => window.location.reload(),
    async notify(title, description, onClick) {
      if (!("Notification" in window)) return
      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission().catch(() => "denied")
          : Notification.permission
      if (permission !== "granted") return
      if (document.visibilityState === "visible" && document.hasFocus()) return
      const notification = new Notification(title, { body: description ?? "" })
      notification.onclick = () => {
        window.focus()
        onClick?.()
        notification.close()
      }
    },
    storage: localStorageNamespace,
    draftStore: typeof indexedDB === "undefined" ? undefined : createBrowserDraftStore(),
    getDefaultServer: async () => settings().getItem("defaultServerUrl"),
    setDefaultServer(value) {
      if (value === null) return void settings().removeItem("defaultServerUrl")
      settings().setItem("defaultServerUrl", value)
    },
  }
  return {
    platform,
    currentServerUrl,
    defaultServerUrl: settings().getItem("defaultServerUrl") ?? currentServerUrl,
  }
}

// In development the page and the server are separate; production serves the page from the server.
function currentServer() {
  if (import.meta.env.VITE_OPENCODE_SERVER_MODE === "none") return undefined
  if (!import.meta.env.DEV) return location.origin
  const loopback =
    location.hostname === "localhost" || location.hostname === "[::1]" || location.hostname.startsWith("127.")
  const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? (loopback ? location.hostname : "localhost")
  return `http://${host}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
}

/** The Solid app's localStorageWithPrefix layout, so both windows read the same keys. */
export function localStorageNamespace(name: string): SyncStorage {
  // The default namespace is the page's bare keys, as the Solid window keeps them on the web.
  const item = (key: string) => (name === DEFAULT_STORAGE ? key : `${name}:${key}`)
  return {
    getItem: (key) => safely(() => localStorage.getItem(item(key))) ?? null,
    setItem: (key, value) => void safely(() => localStorage.setItem(item(key), value)),
    removeItem: (key) => void safely(() => localStorage.removeItem(item(key))),
  }
}

// Storage throws in private windows and sandboxed frames; the app then runs without persistence.
function safely<Value>(read: () => Value) {
  try {
    return read()
  } catch {
    return undefined
  }
}
