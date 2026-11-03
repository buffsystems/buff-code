// The window's model visibility choices reach every connected server (#743): the service keeps
// the last list it was handed and offers the same models to the phone as the composer's picker
// offers here. Sent on every connect and on every change; the window stays the source.

import { BuffModelPrefs } from "@opencode/schema/buff-model-prefs"
import { useEffect } from "react"
import type { ServerConnection } from "../../core/servers"
import { serverKey } from "../../core/servers"
import { usePlatform } from "../../platform/context"
import { useConnection, useServer, useServers } from "../../react/core"
import { useStore } from "../../react/use-store"
import { modelPreferences } from "./preferences"

function SyncOne(props: { conn: ServerConnection }) {
  const server = useServer(props.conn)
  const connected = useConnection(server).status === "connected"
  const prefs = modelPreferences(usePlatform().storage)
  const ready = useStore(prefs.loaded, (value) => value)
  const user = useStore(prefs.store, (state) => state.user)
  useEffect(() => {
    if (!connected || !ready) return
    // A server without the RPC (an older service) just refuses: nothing to show for it.
    void server
      .api()
      .rpc(BuffModelPrefs.Rpc)
      .setPrefs({ user })
      .catch(() => undefined)
  }, [connected, ready, user, server])
  return null
}

export function ModelPrefsSync() {
  const servers = useServers()
  return (
    <>
      {servers.map((conn) => (
        <SyncOne key={serverKey(conn)} conn={conn} />
      ))}
    </>
  )
}
