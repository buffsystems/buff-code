// Buff's session marks as Home reads them (#452, #470): archived sessions and side conversations
// stay off Home. The core keeps the marks; they reload when it says they changed or a side
// conversation opens.

import { BuffSessionMarks } from "@opencode/schema/buff-session-marks"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import type { Server } from "../core/servers"
import { useConnection } from "../react/core"

const RELOAD = new Set(["rpc.buff.session-marks.changed", "rpc.buff.side.opened"])

export function useSessionMarks(server: Server) {
  const connected = useConnection(server).status === "connected"
  const client = useQueryClient()
  const key = ["session-marks", server.key]
  useEffect(
    () =>
      server.event.listen((event) => {
        if (RELOAD.has(event.type)) void client.invalidateQueries({ queryKey: key })
      }),
    [server, client],
  )
  const marks = useQuery({
    queryKey: key,
    enabled: connected,
    queryFn: () =>
      server
        .api()
        .rpc(BuffSessionMarks.Rpc)
        .get(undefined)
        .catch(() => BuffSessionMarks.EMPTY),
    retry: false,
    staleTime: Infinity,
  })
  return marks.data ?? BuffSessionMarks.EMPTY
}
