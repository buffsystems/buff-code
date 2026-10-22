// Per-location catalogs and info (#584), ported from the Solid data layer's locationResource and
// location API: each read loads once per invalidation, keyed by the requested location, and
// publishes under the server's canonical location.

import type { LocationRef } from "@opencode/client/promise"
import { defaultLocation, locationQuery, type DataContext } from "./context"
import { locationKey, withLocation, type LocationData } from "./state"

function locationResource<Field extends keyof LocationData>(
  context: DataContext,
  field: Field,
  load: (location: ReturnType<typeof locationQuery>) => Promise<{ location: LocationRef; data: LocationData[Field] }>,
  options?: { alias?: boolean },
) {
  const publish = (key: string, value: LocationData[Field]) =>
    context.store.set((state) => withLocation(state, key, (data) => ({ ...data, [field]: value })))
  const target = (ref?: LocationRef) => ref ?? defaultLocation(context)
  return {
    list: (ref?: LocationRef) => context.store.get().location[locationKey(target(ref))]?.[field],
    sync: (ref?: LocationRef) => {
      const location = target(ref)
      const id = locationKey(location)
      return context.gate.run(`location.${field}:${id}`, async () => {
        const response = await load(locationQuery(location))
        const key = locationKey(response.location)
        publish(key, response.data)
        if (options?.alias && key !== id) publish(id, response.data)
      })
    },
    invalidate: (ref?: LocationRef) => context.gate.invalidate(`location.${field}:${locationKey(target(ref))}`),
  }
}

export function createLocationReads(context: DataContext, discoverProject: (projectID: string | undefined) => void) {
  const api = context.api
  const target = (ref?: LocationRef) => ref ?? defaultLocation(context)
  const shell = locationResource(context, "shell", async (location) => {
    const response = await api().shell.list({ location })
    const ref = { directory: response.location.directory }
    return {
      location: response.location,
      data: Object.fromEntries(response.data.map((info) => [info.id, { ...info, location: ref }])),
    }
  })
  const catalogs = {
    vcs: locationResource(context, "vcs", (location) => api().vcs.get({ location })),
    agent: locationResource(context, "agent", (location) => api().agent.list({ location })),
    command: locationResource(context, "command", (location) => api().command.list({ location })),
    config: locationResource(context, "config", async (location) => ({
      location: { directory: location.directory },
      data: await api().config.get({ location }),
    })),
    integration: locationResource(context, "integration", (location) => api().integration.list({ location })),
    mcpServer: locationResource(context, "mcpServer", (location) => api().mcp.list({ location })),
    mcpResource: locationResource(context, "mcpResource", async (location) => {
      const response = await api().mcp.resource.catalog({ location })
      return { location: response.location, data: response.data.resources }
    }),
    model: locationResource(context, "model", (location) => api().model.list({ location }), { alias: true }),
    provider: locationResource(context, "provider", (location) => api().provider.list({ location }), { alias: true }),
    reference: locationResource(context, "reference", (location) => api().reference.list({ location })),
    skill: locationResource(context, "skill", (location) => api().skill.list({ location })),
  }

  const syncInfo = (ref?: LocationRef) => {
    const current = target(ref)
    return context.gate.run(`location:${locationKey(current)}`, async () => {
      const location = await api().location.get({ location: locationQuery(current) })
      context.store.set((state) => {
        const next = withLocation(state, locationKey(location), (data) => ({ ...data, info: location }))
        return ref ? next : { ...next, defaultLocation: { directory: location.directory } }
      })
      discoverProject(location.project?.id)
    })
  }

  const websearch = {
    list: (ref?: LocationRef) => context.store.get().location[locationKey(target(ref))]?.websearch,
    async refresh(ref?: LocationRef) {
      const providers = await api().websearch.providers({ location: locationQuery(target(ref)) })
      context.store.set((state) =>
        withLocation(state, locationKey(providers.location), (data) => ({ ...data, websearch: providers.data })),
      )
    },
  }

  return {
    ...catalogs,
    shell,
    websearch,
    info: (ref?: LocationRef) => context.store.get().location[locationKey(target(ref))]?.info,
    default: () => defaultLocation(context),
    syncInfo,
    async sync(ref?: LocationRef) {
      await syncInfo(ref)
      const location = target(ref)
      await Promise.all([
        ...Object.entries(catalogs).flatMap(([name, resource]) => (name === "config" ? [] : [resource.sync(location)])),
        shell.sync(location),
      ])
    },
    invalidate(ref?: LocationRef) {
      const location = target(ref)
      context.gate.invalidate(`location:${locationKey(location)}`)
      Object.values(catalogs).forEach((resource) => resource.invalidate(location))
      shell.invalidate(location)
    },
  }
}

export type LocationReads = ReturnType<typeof createLocationReads>
