// Mount one session slot for `bun test` (#584): the window's providers and a session over a fake
// server whose API answers from `routes` (see core/data/fake-api.ts).

import type { ReactNode } from "react"
import type { ConnectionState } from "../core/connection"
import { createData } from "../core/data/data"
import { fakeApi } from "../core/data/fake-api"
import { createEventSource } from "../core/events"
import { serverKey, type Server, type ServerConnection } from "../core/servers"
import { createStore } from "../core/store"
import { CommandProvider } from "../commands/provider"
import { DialogProvider } from "../dialog/dialogs"
import { english } from "../i18n/i18n"
import { I18nProvider } from "../i18n/provider"
import { render } from "../test/render"
import { memoryStorage } from "../test/storage"
import { ShellSettingsProvider } from "../shell/settings-context"
import { SessionProvider, SessionViewsProvider } from "./context"
import type { SessionPanes } from "./view"

/** A Server over a fake API: its data store is real, its requests are answered by `routes`. */
export function fakeServer(routes: Parameters<typeof fakeApi>[0] = {}) {
  const fake = fakeApi(routes)
  const events = createEventSource()
  const connection = createStore<ConnectionState>({ status: "connected", attempt: 0 })
  const data = createData({ api: () => fake.api, directory: "", event: events.event, connection })
  const conn: ServerConnection = { type: "http", http: { url: "http://server.test" } }
  const server: Server = {
    conn,
    key: serverKey(conn),
    api: () => fake.api,
    event: events.event,
    connection,
    data,
    resync: () => undefined,
    dispose: () => data.dispose(),
  }
  return { server, events, calls: fake.calls, called: fake.called }
}

export function renderSessionSlot(
  node: ReactNode,
  options: { sessionID?: string; routes?: Parameters<typeof fakeApi>[0] } = {},
) {
  const fake = fakeServer(options.routes)
  const storage = memoryStorage()
  const store = createStore<Record<string, SessionPanes>>({})
  const panes = {
    store,
    set: (key: string, patch: SessionPanes) => store.set((all) => ({ ...all, [key]: { ...all[key], ...patch } })),
  }
  const sessionID = options.sessionID ?? "ses_test"
  const view = render(
    <I18nProvider storage={storage} initial={{ locale: "en", dictionary: english }}>
      <DialogProvider>
        <CommandProvider>
          <ShellSettingsProvider storage={() => storage}>
            <SessionViewsProvider panes={panes}>
              <SessionProvider
                value={{
                  conn: fake.server.conn,
                  server: fake.server,
                  serverKey: fake.server.key,
                  sessionID,
                  viewKey: sessionID,
                }}
              >
                {node}
              </SessionProvider>
            </SessionViewsProvider>
          </ShellSettingsProvider>
        </CommandProvider>
      </DialogProvider>
    </I18nProvider>,
  )
  return { ...view, ...fake, panes }
}
