// A Buff page (#447, #448) on the window's frame, like Home (#471): a scrolling panel with a
// centred column. The first known server serves it, like settings do.

import "./page.css"
import type { ReactNode } from "react"
import { serverKey } from "../core/servers"
import type { Server } from "../core/servers"
import { useServer, useServers } from "../react/core"
import { tabServer } from "../shell/tabs/tabs"
import { useTabs } from "../shell/tabs/provider"

export function BuffPage(props: { component: string; children?: ReactNode }) {
  return (
    <div className="buff-page-panel">
      <div className="buff-page" data-component={props.component}>
        {props.children}
      </div>
    </div>
  )
}

/** Render with the first known server's controller; nothing while there is none. */
export function WithFirstServer(props: { children: (server: Server) => ReactNode }) {
  const conn = useServers()[0]
  if (!conn) return null
  return <FirstServer key={serverKey(conn)} conn={conn} render={props.children} />
}

function FirstServer(props: { conn: Parameters<typeof useServer>[0]; render: (server: Server) => ReactNode }) {
  const server = useServer(props.conn)
  return <>{props.render(server)}</>
}

/** Open a session of a server in a tab and show it (a run's session, a notice's). */
export function useOpenSession() {
  const tabs = useTabs()
  return (server: Server, sessionID: string) =>
    tabs.select(tabs.addSessionTab({ server: tabServer(server.key), sessionId: sessionID }))
}
