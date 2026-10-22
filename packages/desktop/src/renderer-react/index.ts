// Buff (#561): the window of Buff Code — the React window on the IPC bridge the Solid desktop
// renderer used: the same store, drafts, menu, zoom, updater, first launch and deep links.
import "../renderer/diagnostics"
import "@opencode/app-react/index.css"
import { mountApp } from "@opencode/app-react"
import { api } from "../renderer/api"
import { startDeepLinks } from "../renderer/startup/deep-links"
import { getLastActiveUrl, setLastActiveUrl } from "../renderer/window/route-storage"
import { createDesktopPlatform } from "./platform"
import { createWindowZoom } from "./zoom"

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found")

startDeepLinks(api)
// The main process creates the window knowing whether this is the first launch; only a fresh
// install, with no answer yet, asks over IPC.
const bootstrap = api.getWindowBootstrap()
const firstLaunch: { pending?: boolean } = { pending: bootstrap.firstLaunchPending }
if (firstLaunch.pending === undefined)
  void api
    .isFirstLaunchOnboardingPending()
    .catch(() => false)
    .then((pending) => (firstLaunch.pending = pending))
const zoom = createWindowZoom(api, navigator.userAgent.includes("Mac"))
const platform = createDesktopPlatform(api, import.meta.env.OPENCODE_VERSION ?? "", {
  zoom,
  firstLaunch: () => firstLaunch.pending,
})
const windowID = api.getWindowID()
let revealed = false

// The bundled server answers once the main process has started it; its credentials are added to
// requests by the main process, so the renderer only knows its address.
void api.awaitInitialization().then((sidecar) =>
  mountApp(root, {
    platform,
    servers: [
      {
        type: "sidecar",
        variant: "base",
        http: { url: sidecar.url },
        reconnect: async () => ({ url: (await api.reconnectService()).url }),
      },
    ],
    defaultServer: "sidecar",
    history: {
      type: "memory",
      initialUrl: getLastActiveUrl(windowID),
      onChange: (url) => setLastActiveUrl(windowID, url),
    },
    onThemeApplied(theme) {
      void api.setTitlebar({ mode: theme.mode, scheme: theme.scheme })
      void api.setBackgroundColor(theme.background)
      // The main process shows a restored window once its theme is painted.
      if (revealed) return
      revealed = true
      void api.themeReady()
    },
  }),
)
