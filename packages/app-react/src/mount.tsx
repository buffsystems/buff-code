import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app"
import type { ServerConnection } from "./core/servers"
import { preloadLanguage } from "./i18n/provider"
import type { Platform } from "./platform/platform"
import { createCore } from "./react/core"
import { createBrowserHistory, createMemoryHistory } from "./router/history"
import { followColorScheme } from "./color-scheme"
import { watchAppliedTheme, type AppliedTheme } from "./theme-report"

export type MountOptions = {
  platform: Platform
  servers: ServerConnection[]
  defaultServer?: string
  canonicalLocalServer?: string
  /** A desktop window keeps its route in memory from `initialUrl`; a web page uses the address bar. */
  history: { type: "browser" } | { type: "memory"; initialUrl?: string; onChange?: (url: string) => void }
  onThemeApplied?: (theme: AppliedTheme) => void
  onError?: (error: unknown) => void
}

export function mountApp(root: HTMLElement, options: MountOptions) {
  const app = createRoot(root)
  const core = createCore({
    platform: options.platform,
    servers: options.servers,
    defaultServer: options.defaultServer,
    canonicalLocalServer: options.canonicalLocalServer,
    onError: options.onError,
  })
  const history =
    options.history.type === "browser" ? createBrowserHistory() : createMemoryHistory(options.history.initialUrl)
  const onChange = options.history.type === "memory" ? options.history.onChange : undefined
  const stopRoute = onChange
    ? history.location.subscribe(() => onChange(history.location.get().pathname + history.location.get().search))
    : undefined
  const stopTheme = options.onThemeApplied ? watchAppliedTheme(options.onThemeApplied) : undefined
  const stopScheme = followColorScheme(document.documentElement)
  void preloadLanguage(options.platform.storage("opencode.global.dat")).then((language) =>
    app.render(
      <StrictMode>
        <App core={core} history={history} language={language} />
      </StrictMode>,
    ),
  )
  return () => {
    stopTheme?.()
    stopScheme()
    stopRoute?.()
    history.dispose()
    app.unmount()
    core.dispose()
  }
}
