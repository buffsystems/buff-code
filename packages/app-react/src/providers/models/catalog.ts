// The provider and model catalog of a location (#584), derived from the core's location data: a
// port of the Solid window's normalizeProviderList (runtime/server/global-sync/utils.ts, which reaches
// Solid's store) and of useProviders / the models list. Shared by settings, dialogs and the composer.

import type { AgentInfo, ModelInfo, ProviderInfo } from "@opencode/client/promise"
import { matchesModelSearch } from "@opencode/app/react-reuse/model-search"
import { popularProviders } from "@opencode/app/react-reuse/provider-order"
import type { Agent, Model, Provider, ProviderListResponse } from "@opencode/app/react-reuse/server-types"

export type CatalogModel = Model & { provider: Provider; latest: boolean }
export type ModelKey = { providerID: string; modelID: string }

const providerCatalogs = new WeakMap<ProviderInfo[], WeakMap<ModelInfo[], ProviderListResponse>>()
const emptyCatalog: ProviderListResponse = { all: new Map(), connected: [], default: {} }

export function normalizeProviderList(providers?: ProviderInfo[], models?: ModelInfo[]): ProviderListResponse {
  if (!providers || !models) return emptyCatalog
  const cached = providerCatalogs.get(providers)?.get(models)
  if (cached) return cached
  const all = new Map<string, Provider>(
    providers.map((provider) => [
      provider.id,
      { id: provider.id, name: provider.name, source: "custom", env: [], options: provider.settings ?? {}, models: {} },
    ]),
  )
  for (const model of models) {
    const provider = all.get(model.providerID)
    if (!provider || model.status === "deprecated") continue
    provider.models[model.id] = toModel(model, provider.id)
  }
  const result = {
    all,
    connected: providers.map((provider) => provider.id),
    default: Object.fromEntries(
      providers.flatMap((provider) => {
        const model = models.find((item) => item.providerID === provider.id && item.status !== "deprecated")
        return model ? [[provider.id, model.id]] : []
      }),
    ),
  }
  const cache = providerCatalogs.get(providers) ?? new WeakMap<ModelInfo[], ProviderListResponse>()
  cache.set(models, result)
  providerCatalogs.set(providers, cache)
  return result
}

function toModel(model: ModelInfo, providerID: string): Model {
  const cost = model.cost.find((item) => item.tier === undefined) ?? model.cost[0]
  const has = (list: readonly string[], kind: string) => list.includes(kind)
  const kinds = (list: readonly string[]) => ({
    text: has(list, "text"),
    audio: has(list, "audio"),
    image: has(list, "image"),
    video: has(list, "video"),
    pdf: has(list, "pdf"),
  })
  return {
    id: model.id,
    providerID: model.providerID,
    api: { id: model.modelID, url: "", npm: model.package ?? providerID },
    name: model.name,
    family: model.family,
    capabilities: {
      temperature: false,
      reasoning: false,
      attachment: model.capabilities.input.some((item) => item !== "text"),
      toolcall: model.capabilities.tools,
      input: kinds(model.capabilities.input),
      output: kinds(model.capabilities.output),
      interleaved: false,
    },
    cost: {
      input: cost?.input ?? 0,
      output: cost?.output ?? 0,
      cache: { read: cost?.cache.read ?? 0, write: cost?.cache.write ?? 0 },
    },
    limit: model.limit,
    status: model.status,
    options: model.settings ?? {},
    headers: model.headers ?? {},
    release_date: new Date(model.time.released).toISOString().slice(0, 10),
    variants: Object.fromEntries(model.variants.map((variant) => [variant.id, variant.settings ?? {}])),
  }
}

export function normalizeAgentList(input: AgentInfo[]): Agent[] {
  return input.map((agent) => ({
    name: agent.id,
    description: agent.description,
    mode: agent.mode,
    hidden: agent.hidden,
    temperature:
      typeof agent.request.settings.temperature === "number" ? agent.request.settings.temperature : undefined,
    topP: typeof agent.request.settings.topP === "number" ? agent.request.settings.topP : undefined,
    color: agent.color,
    permission: agent.permissions.map((rule) => ({
      permission: rule.action,
      pattern: rule.resource,
      action: rule.effect,
    })),
    model: agent.model && { providerID: agent.model.providerID, modelID: agent.model.id },
    variant: agent.model?.variant,
    prompt: agent.system,
    options: agent.request.settings,
    steps: agent.steps,
  }))
}

export function connectedProviders(catalog: ProviderListResponse) {
  const connected = new Set(catalog.connected)
  return [...catalog.all.values()].filter((provider) => connected.has(provider.id))
}

/** Providers a person pays for: any connected one but the free OpenCode tier without priced models. */
export function paidProviders(catalog: ProviderListResponse) {
  return connectedProviders(catalog).filter(
    (provider) => provider.id !== "opencode" || Object.values(provider.models).some((model) => model.cost?.input),
  )
}

/** Every model of the connected providers, named without "(latest)" and flagged by it. */
export function catalogModels(catalog: ProviderListResponse): CatalogModel[] {
  return connectedProviders(catalog).flatMap((provider) =>
    Object.values(provider.models).map((model) => ({
      ...model,
      provider,
      name: model.name.replace("(latest)", "").trim(),
      latest: model.name.includes("(latest)"),
    })),
  )
}

export function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

// luxon's diffNow().as("months") used an average month; the Solid window keeps the same window.
const sixMonths = 6 * 30.436875 * 24 * 60 * 60 * 1000

/** The newest model of each family per provider, released within six months: shown by default. */
export function latestModels(models: CatalogModel[], now = Date.now()) {
  const families = new Map<string, CatalogModel>()
  for (const model of models) {
    const released = Date.parse(model.release_date)
    if (!(Math.abs(now - released) < sixMonths)) continue
    const key = `${model.provider.id}\u0000${model.family ?? ""}`
    const current = families.get(key)
    if (!current || model.release_date > current.release_date) families.set(key, model)
  }
  return new Set([...families.values()].map((model) => modelKey({ providerID: model.provider.id, modelID: model.id })))
}

/**
 * Whether a model shows in the pickers: the person's choice first; otherwise the newest of its
 * family, and models without a readable release date.
 */
export function modelVisible(
  model: Pick<CatalogModel, "id" | "release_date" | "provider">,
  choice: "show" | "hide" | undefined,
  latest: ReadonlySet<string>,
) {
  if (choice === "hide") return false
  if (choice === "show") return true
  if (latest.has(modelKey({ providerID: model.provider.id, modelID: model.id }))) return true
  return !Number.isFinite(Date.parse(model.release_date))
}

export type ModelGroup = { provider: string; name: string; items: CatalogModel[] }

/** Models matching a search, grouped by provider: the well-known providers first, then by name. */
export function groupModels(models: readonly CatalogModel[], query: string): ModelGroup[] {
  const groups = new Map<string, ModelGroup>()
  models
    .filter((model) => matchesModelSearch(query, [model.provider.name, model.name, model.id]))
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .forEach((model) => {
      const group = groups.get(model.provider.id) ?? {
        provider: model.provider.id,
        name: model.provider.name,
        items: [],
      }
      group.items.push(model)
      groups.set(model.provider.id, group)
    })
  const rank = (id: string) => {
    const index = popularProviders.indexOf(id)
    return index === -1 ? popularProviders.length : index
  }
  return [...groups.values()].toSorted((a, b) => rank(a.provider) - rank(b.provider) || a.name.localeCompare(b.name))
}
