// Auto-accept of permission requests on one server (#584), the Solid window's
// createPermissionAutoApprover: while the window-wide setting is on, every request the server asks —
// by event, found by a sweep on each connect, or synced into the store when a session opens — is
// answered «once». The setting applies to every session, tab and server at once.

import type { PermissionRequest } from "@opencode/client/promise"
import type { Readable } from "./store"
import type { Server } from "./servers"

const respondedLimit = 1000
const retryLimit = 2
const retryDelayMs = 1000

export type AutoApproveServer = Pick<Server, "api" | "event" | "connection"> & {
  data: { state: Server["data"]["state"]; session: Pick<Server["data"]["session"], "get" | "sync" | "invalidate"> }
}

export function createPermissionAutoApprover(input: {
  server: AutoApproveServer
  enabled: Readable<boolean>
  /** Timers, replaceable in tests. */
  later?: (run: () => void, ms: number) => void
}) {
  const { server, enabled } = input
  const later = input.later ?? ((run, ms) => void setTimeout(run, ms))
  const state = { disposed: false, generation: 0, responded: new Set<string>() }

  const stopEvents = server.event.listen((event) => {
    if (event.type === "permission.asked" && enabled.get()) approve(event.data)
  })

  // The event stream does not replay requests asked while disconnected, and requests may already be
  // pending before the setting turns on, so sweep on every connect (and on turning it on).
  const connected = () => server.connection.get().status === "connected"
  const sweepState = { armed: false }
  const checkSweep = () => {
    const ready = enabled.get() && connected()
    if (ready && !sweepState.armed) void sweepWithRetry(++state.generation, 0)
    sweepState.armed = ready
  }

  // Requests that reach the store — an idle session's, synced when its view opens.
  const seen: { permission?: object } = {}
  const approveStored = () => {
    const permission = server.data.state.get().session.permission
    if (!enabled.get() || seen.permission === permission) return
    seen.permission = permission
    Object.values(permission).forEach((requests) => requests?.forEach(approve))
  }

  const stops = [
    stopEvents,
    server.connection.subscribe(checkSweep),
    enabled.subscribe(() => {
      seen.permission = undefined
      checkSweep()
      approveStored()
    }),
    server.data.state.subscribe(approveStored),
  ]
  checkSweep()
  approveStored()

  // An incomplete sweep leaves pending requests hidden with no later trigger, so it is retried a
  // bounded number of times; a newer sweep supersedes scheduled retries.
  async function sweepWithRetry(generation: number, attempt: number) {
    const complete = await sweep()
    if (complete || attempt >= retryLimit) return
    later(() => {
      if (state.disposed || !enabled.get() || generation !== state.generation) return
      void sweepWithRetry(generation, attempt + 1)
    }, retryDelayMs * (attempt + 1))
  }

  async function sweep() {
    const inventory = await sweepLocations()
    const listed = await Promise.all(
      inventory.directories.map((directory) =>
        server
          .api()
          .permission.request.list({ location: { directory } })
          .then((pending) => {
            if (!state.disposed) pending.data.forEach(approve)
            return true
          })
          .catch(() => false),
      ),
    )
    return inventory.complete && listed.every(Boolean)
  }

  // Active sessions are the inventory (server-wide, so it covers sessions no tab loaded); every
  // known session is swept too, since a request can be parked on an idle one. Active sessions are
  // resynced first: another client may have moved one while this one was away.
  async function sweepLocations() {
    const active = await server
      .api()
      .session.active()
      .catch(() => undefined)
    const ids = Object.keys(active ?? {})
    const synced = await Promise.all(
      ids.map((id) => {
        server.data.session.invalidate(id)
        return server.data.session.sync(id).then(
          () => true,
          () => false,
        )
      }),
    )
    const known = Object.values(server.data.state.get().session.info)
    const directories = [
      ...ids.flatMap((id) => {
        const directory = server.data.session.get(id)?.location.directory
        return directory ? [directory] : []
      }),
      ...known.map((session) => session.location.directory),
    ]
    return { directories: [...new Set(directories)], complete: active !== undefined && synced.every(Boolean) }
  }

  function approve(request: PermissionRequest, attempt = 0) {
    if (state.disposed || !enabled.get() || state.responded.has(request.id)) return
    remember(request.id)
    server
      .api()
      .permission.reply({ sessionID: request.sessionID, requestID: request.id, decision: "once" })
      .catch(() => {
        // A failed reply leaves the request pending but hidden (prompts hide while auto-accept is
        // on), so it is retried a bounded number of times; later sweeps retry it after that.
        state.responded.delete(request.id)
        if (state.disposed || attempt >= retryLimit) return
        later(() => approve(request, attempt + 1), retryDelayMs * (attempt + 1))
      })
  }

  function remember(id: string) {
    state.responded.add(id)
    for (const oldest of state.responded) {
      if (state.responded.size <= respondedLimit) break
      state.responded.delete(oldest)
    }
  }

  return () => {
    state.disposed = true
    stops.forEach((stop) => stop())
  }
}
