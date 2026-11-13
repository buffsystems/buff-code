// Recents (#922): a session deleted anywhere — its header, the console, the phone — leaves the cached
// session index at once; the live sessions drop it themselves (core/data/reduce).

import type { SessionInfo } from "@opencode/client/promise"
import type { QueryClient, QueryKey } from "@tanstack/react-query"
import type { EventStream } from "../../core/events"

export function followDeletions(events: EventStream, client: QueryClient, key: QueryKey) {
  return events.on("session.deleted", (event) =>
    client.setQueryData<SessionInfo[]>(key, (list) => list?.filter((session) => session.id !== event.data.sessionID)),
  )
}
