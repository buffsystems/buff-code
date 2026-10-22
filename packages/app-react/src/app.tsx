import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"
import { CommandProvider } from "./commands/provider"
import { DialogProvider } from "./dialog/dialogs"
import { Home } from "./home/home"
import type { Dictionary, Locale } from "./i18n/i18n"
import { I18nProvider } from "./i18n/provider"
import { NewSessionRoute } from "./new-session/route"
import { PlatformProvider } from "./platform/context"
import { CoreProvider, type Core } from "./react/core"
import type { History } from "./router/history"
import { RouterProvider, useRoute } from "./router/router"
import { registeredScreens } from "./router/screens"
import { SessionViewsProvider } from "./session/context"
import { SessionRoute } from "./session/route"
import { ErrorBoundary } from "./shell/errors/error-page"
import { NotificationsProvider } from "./shell/notifications/provider"
import { PermissionAutoApprovers } from "./shell/auto-approve"
import { DesktopBridge } from "./shell/desktop-bridge"
import { BuffSessionList } from "./shell/sessions/session-list"
import { ShellSettingsProvider, useShellSettings, useShellSettingsCell } from "./shell/settings-context"
import { Shell } from "./shell/shell"
import { TabsProvider, useTabs } from "./shell/tabs/provider"

export type AppProps = {
  core: Core
  history: History
  language: { locale: Locale; dictionary: Dictionary }
}

/** The React window of Buff Code (#561): providers around the routed screens. */
export function App(props: AppProps) {
  const [queries] = useState(() => new QueryClient())
  const storage = props.core.platform.storage("opencode.global.dat")
  return (
    <PlatformProvider value={props.core.platform}>
      <I18nProvider storage={storage} initial={props.language}>
        <ErrorBoundary>
          <QueryClientProvider client={queries}>
            <CoreProvider core={props.core}>
              <RouterProvider history={props.history}>
                <DialogProvider>
                  <ShellSettingsProvider storage={props.core.platform.storage}>
                    <Commands>
                      <TabsProvider history={props.history}>
                        <TabSessionViews>
                          <NotificationsProvider>
                            <PermissionAutoApprovers />
                            <DesktopBridge />
                            <div data-component="app-react" className="flex h-full flex-col">
                              <ShellWithSettings>
                                <Screen />
                              </ShellWithSettings>
                            </div>
                          </NotificationsProvider>
                        </TabSessionViews>
                      </TabsProvider>
                    </Commands>
                  </ShellSettingsProvider>
                </DialogProvider>
              </RouterProvider>
            </CoreProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </I18nProvider>
    </PlatformProvider>
  )
}

/** A session tab's panes are the tab's own: the session views read and write them through the tabs. */
function TabSessionViews(props: { children?: ReactNode }) {
  const tabs = useTabs()
  const [panes] = useState(() => ({ store: tabs.panes, set: tabs.setPanes }))
  return <SessionViewsProvider panes={panes}>{props.children}</SessionViewsProvider>
}

/** Commands follow the keybinds the person set in settings. */
function Commands(props: { children?: ReactNode }) {
  const settings = useShellSettingsCell()
  return <CommandProvider keybindOverride={(id) => settings.store.get().keybinds[id]}>{props.children}</CommandProvider>
}

function ShellWithSettings(props: { children?: ReactNode }) {
  const tabLayout = useShellSettings((settings) => settings.tabLayout)
  return (
    <Shell tabLayout={tabLayout} sessions={<BuffSessionList />}>
      {props.children}
    </Shell>
  )
}

function Screen() {
  const route = useRoute()
  if (route.name === "home") return <Home />
  if (route.name === "session") return <SessionRoute serverKey={route.serverKey} sessionID={route.sessionID} />
  if (route.name === "new-session") return <NewSessionRoute />
  if (route.name === "not-found") return <Pending name={route.name} />
  const Registered = registeredScreens[route.name]
  return Registered ? <Registered /> : <Pending name={route.name} />
}

function Pending(props: { name: string }) {
  return (
    <section data-component="screen-pending" data-screen={props.name} className="p-6">
      <p className="ui-note">{props.name}</p>
    </section>
  )
}
