// The reads server events trigger (#584): the side of the Solid data layer's handleEvent that
// revalidates instead of folding — re-reading a session, a transcript or a location catalog.

import type { LocationRef, OpenCodeEvent } from "@opencode/client/promise"
import { defaultLocation, locationQuery, type DataContext } from "./context"
import type { LocationReads } from "./location-reads"
import { messageIDFromEvent } from "./reduce"
import type { SessionReads } from "./session-reads"
import { editInfo, editMessages, locationKey, upsertMessage, withLocation } from "./state"

export type EffectReads = {
  session: SessionReads
  location: LocationReads
  project: { sync(): Promise<void>; invalidate(): void }
  discoverProject(projectID: string | undefined): void
  /** server.connected: re-read which sessions are running, reconciled with events meanwhile. */
  hydrateActive(): void
}

export function runEffects(context: DataContext, reads: EffectReads, event: OpenCodeEvent) {
  const refresh = context.refresh
  const state = () => context.store.get()
  switch (event.type) {
    case "server.connected": {
      reads.hydrateActive()
      refresh(() =>
        context
          .api()
          .location.get({ location: locationQuery(defaultLocation(context)) })
          .then((location) =>
            context.store.set((current) =>
              withLocation(current, locationKey(location), (data) => ({ ...data, info: location })),
            ),
          ),
      )
      refresh(() => reads.location.vcs.sync())
      refresh(() => reads.project.sync())
      return
    }
    case "session.deleted":
      ;[
        `session:${event.data.sessionID}`,
        `session.family:${event.data.sessionID}`,
        `session.pending:${event.data.sessionID}`,
        `session.message:${event.data.sessionID}`,
        `session.permission:${event.data.sessionID}`,
        `session.form:${event.data.sessionID}:`,
      ].forEach((key) => context.gate.invalidate(key))
      return
    case "session.created":
      reads.session.invalidate(event.data.sessionID)
      refresh(() => reads.session.sync(event.data.sessionID))
      // A newly created session starts empty, so live events are its source of truth. Separate
      // pending and transcript reads can both miss an input promoted between them, so skip them.
      context.gate.complete(`session.pending:${event.data.sessionID}`)
      context.gate.complete(`session.message:${event.data.sessionID}`)
      return
    case "session.model.selected":
      if (!state().session.message[event.data.sessionID]) return
      refresh(() =>
        context
          .api()
          .session.message.get({ sessionID: event.data.sessionID, messageID: messageIDFromEvent(event.id) })
          .then((item) =>
            context.store.set((current) =>
              editMessages(current, event.data.sessionID, (messages) => upsertMessage(messages, item)),
            ),
          ),
      )
      return
    case "session.renamed":
      // Preserve the live title when it races the session's initial read.
      refresh(() => {
        const family = context.gate.pending(`session.family:${event.data.sessionID}`)
          ? reads.session.sync(event.data.sessionID, { children: true })
          : Promise.resolve()
        return Promise.all([reads.session.sync(event.data.sessionID), family]).then(() =>
          context.store.set((current) =>
            editInfo(current, event.data.sessionID, (info) => ({ ...info, title: event.data.title })),
          ),
        )
      })
      return
    case "worktree.resolved":
      reads.discoverProject(event.data.projectID)
      Object.values(state().session.info).forEach((info) => {
        const explicit = event.data.adopted?.includes(info.projectID)
        if (explicit ? state().project.info[info.projectID]?.canonical : info.location.directory) return
        reads.session.invalidate(info.id)
        refresh(() => reads.session.sync(info.id))
      })
      return
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted": {
      const running = state().session.message[event.data.sessionID]?.some(
        (item) =>
          item.type === "assistant" &&
          item.content.some(
            (part) => part.type === "tool" && (part.state.status === "streaming" || part.state.status === "running"),
          ),
      )
      if (running) {
        reads.session.message.invalidate(event.data.sessionID)
        refresh(() => reads.session.message.sync(event.data.sessionID))
      }
      revalidateSession(context, reads, event.data.sessionID)
      return
    }
    case "session.viewed":
      revalidateSession(context, reads, event.data.sessionID)
      return
    case "credential.updated":
    case "credential.switched":
      locations(context).forEach((location) => {
        if (event.type === "credential.updated") {
          reads.location.integration.invalidate(location)
          return refresh(() => reads.location.integration.sync(location))
        }
        reads.location.model.invalidate(location)
        reads.location.provider.invalidate(location)
        refresh(() => Promise.all([reads.location.model.sync(location), reads.location.provider.sync(location)]))
      })
      return
  }
  if (event.location) runLocationEffects(context, reads, event, event.location)
}

// An event can overtake the first read; revalidate when that read is still active.
function revalidateSession(context: DataContext, reads: EffectReads, sessionID: string) {
  if (!context.store.get().session.info[sessionID] && !context.gate.has(`session:${sessionID}`)) return
  reads.session.invalidate(sessionID)
  context.refresh(() => reads.session.sync(sessionID))
}

function runLocationEffects(context: DataContext, reads: EffectReads, event: OpenCodeEvent, location: LocationRef) {
  const catalogs = reads.location
  const reload = (...resources: { invalidate(ref?: LocationRef): void; sync(ref?: LocationRef): Promise<void> }[]) => {
    resources.forEach((resource) => resource.invalidate(location))
    context.refresh(() => Promise.all(resources.map((resource) => resource.sync(location))))
  }
  switch (event.type) {
    case "provider.updated":
      return reload(catalogs.provider)
    case "model.updated":
      return reload(catalogs.model)
    case "agent.updated":
      return reload(catalogs.agent)
    case "command.updated":
      return reload(catalogs.command)
    case "skill.updated":
      return reload(catalogs.skill)
    case "reference.updated":
      return reload(catalogs.reference)
    case "integration.updated":
      return reload(catalogs.integration, catalogs.model, catalogs.provider)
    case "config.updated":
      catalogs.config.invalidate(location)
      if (catalogs.config.list(location) !== undefined || context.gate.has(`location.config:${locationKey(location)}`))
        context.refresh(() => catalogs.config.sync(location))
      context.refresh(() => catalogs.websearch.refresh(location))
      return
    case "websearch.updated":
      return context.refresh(() => catalogs.websearch.refresh(location))
    // Authenticating an MCP integration reconnects its server, which emits mcp.status.changed once
    // per server as each settles; a location booting nine servers would refetch nine times.
    case "mcp.status.changed":
      catalogs.mcpServer.invalidate(location)
      return context.settle(`mcp.status:${locationKey(location)}`, () => catalogs.mcpServer.sync(location))
    case "mcp.resources.changed":
      return reload(catalogs.mcpResource)
  }
}

function locations(context: DataContext) {
  return Object.keys(context.store.get().location).map((key) => {
    const [directory, workspaceID] = JSON.parse(key) as [string, string | null]
    return { directory, workspaceID: workspaceID ?? undefined }
  })
}
