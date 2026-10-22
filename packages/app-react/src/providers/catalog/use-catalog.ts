// A server's providers, models and integrations in one location (#584), ported from the Solid
// window's useProviders / useIntegrations: loaded when the server is connected, read from the core
// data. Without a directory they are the server's default location's.

import { popularProviders } from "@opencode/app/react-reuse/provider-order"
import type { IntegrationInfo, LocationRef } from "@opencode/client/promise"
import { useEffect, useMemo } from "react"
import type { Server } from "../../core/servers"
import { useConnection, useServerData } from "../../react/core"
import { locationKey } from "../../core/data/state"
import type { Provider, ProviderListResponse } from "@opencode/app/react-reuse/server-types"
import {
  catalogModels,
  connectedProviders,
  normalizeProviderList,
  paidProviders,
  type CatalogModel,
} from "../models/catalog"

const none: IntegrationInfo[] = []
const popularSet = new Set(popularProviders)

export { popularProviders }

const refOf = (directory: string | undefined): LocationRef | undefined => (directory ? { directory } : undefined)

/** Where a directory's catalogs live in the core data; the default location without one. */
function useLocationKey(server: Server, directory: string | undefined) {
  const fallback = useServerData(server, (state) => state.defaultLocation)
  return locationKey(refOf(directory) ?? fallback)
}

// Load once connected, and again when the directory changes; the default location needs its info first.
function useSync(server: Server, directory: string | undefined, load: (ref: LocationRef) => Promise<unknown>) {
  const connection = useConnection(server)
  useEffect(() => {
    if (connection.status !== "connected") return
    const ref = refOf(directory)
    void (async () => {
      if (!ref) await server.data.location.syncInfo()
      await load(ref ?? server.data.location.default())
    })().catch(() => undefined)
  }, [server, directory, connection.status])
}

export function useIntegrations(server: Server, directory: string | undefined) {
  useSync(server, directory, (ref) => server.data.location.integration.sync(ref))
  const key = useLocationKey(server, directory)
  return useServerData(server, (state) => state.location[key]?.integration ?? none)
}

export type ProviderCatalog = {
  /** Both the providers and the models of the location have loaded. */
  ready: boolean
  catalog: ProviderListResponse
  integrations: IntegrationInfo[]
  /** The well-known providers one can connect, in the catalog's order of preference. */
  popular: { id: string; name: string }[]
  connected: Provider[]
  paid: Provider[]
  models: CatalogModel[]
}

export function useProviderCatalog(server: Server, directory: string | undefined): ProviderCatalog {
  useSync(server, directory, (ref) =>
    Promise.all([server.data.location.provider.sync(ref), server.data.location.model.sync(ref)]),
  )
  const key = useLocationKey(server, directory)
  const providers = useServerData(server, (state) => state.location[key]?.provider)
  const models = useServerData(server, (state) => state.location[key]?.model)
  const integrations = useIntegrations(server, directory)
  return useMemo(() => {
    const catalog = normalizeProviderList(providers, models)
    // V2 servers list only available providers: the connectable ones come from the integrations.
    const listed = integrations
      .filter((integration) => popularSet.has(integration.id))
      .map((integration) => ({ id: integration.id, name: integration.name }))
    const seen = new Set(listed.map((item) => item.id))
    const popular = [
      ...listed,
      ...[...catalog.all.values()]
        .filter((provider) => popularSet.has(provider.id) && !seen.has(provider.id))
        .map((provider) => ({ id: provider.id, name: provider.name })),
    ]
    return {
      ready: providers !== undefined && models !== undefined,
      catalog,
      integrations,
      popular,
      connected: connectedProviders(catalog),
      paid: paidProviders(catalog),
      models: catalogModels(catalog),
    }
  }, [providers, models, integrations])
}
