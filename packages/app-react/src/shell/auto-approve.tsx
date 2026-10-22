// Auto-accept on every server of the window (#584): the Solid window runs one approver per server
// connection, so a request on a server with no open tab is answered too.

import { useEffect, useMemo } from "react"
import { createPermissionAutoApprover } from "../core/auto-approve"
import { serverKey, type ServerConnection } from "../core/servers"
import { derive } from "../core/store"
import { useCore, useServers } from "../react/core"
import { useSettingsModel } from "./settings-context"

export function PermissionAutoApprovers() {
  const servers = useServers()
  return servers.map((conn) => <ServerAutoApprover key={serverKey(conn)} conn={conn} />)
}

function ServerAutoApprover(props: { conn: ServerConnection }) {
  const core = useCore()
  const model = useSettingsModel()
  const enabled = useMemo(() => derive(model.store, (settings) => settings.permissions.autoApprove), [model])
  useEffect(
    () => createPermissionAutoApprover({ server: core.registry.ensure(props.conn), enabled }),
    [core, props.conn, enabled],
  )
  return null
}
