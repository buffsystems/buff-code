// Which agent, model and variant the composer sends with (#584): a port of the Solid window's
// useLocal (providers/models/selection.tsx) as a pure resolution over snapshots plus the writes
// that change it. A session's pick is kept per workspace ("workspace:model-selection") until the
// server confirms it; a new-session draft keeps its pick in memory until the session exists.

import { BUFF_PROVIDER } from "@opencode/app/react-reuse/buff-providers"
import { BuffModelDefault } from "@opencode/schema/buff-model-default"
import { hasCustomAgent, resolveAgent } from "@opencode/app/react-reuse/model-agent"
import { getConfiguredAgentVariant, cycleModelVariant, resolveModelVariant } from "@opencode/app/react-reuse/model-variant"
import { Persistence } from "@opencode/app/react-reuse/persistence-schema"
import type { ConfigEntry, SessionInfo } from "@opencode/client/promise"
import type { Agent, ProviderListResponse } from "@opencode/app/react-reuse/server-types"
import { Schema } from "effect"
import {
  catalogModels,
  latestModels,
  modelVisible,
  paidProviders,
  connectedProviders,
  type CatalogModel,
  type ModelKey,
} from "../../../providers/models/catalog"
import type { ModelPreferences } from "../../../providers/models/preferences"

const ModelKeySchema = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Schema.optional(Schema.String),
})
const ChoiceSchema = Schema.Struct({
  model: Persistence.optional(ModelKeySchema),
  variant: Persistence.optional(Schema.NullOr(Schema.String)),
})
const StateSchema = Schema.Struct({
  ...ChoiceSchema.fields,
  agent: Persistence.optional(Schema.String),
  choices: Persistence.optional(Schema.Record(Schema.String, ChoiceSchema)),
})
export const ModelSelectionSchema = Persistence.struct({
  session: Schema.Record(
    Schema.String,
    Schema.mutableKey(Persistence.fallback(Schema.UndefinedOr(StateSchema), () => undefined)),
  ),
})

export type SelectionState = typeof StateSchema.Type
export type ModelSelectionDocument = typeof ModelSelectionSchema.Type

export type SelectionInput = {
  /** The pick of this session or draft, if any. */
  scope?: SelectionState
  /** The session as the server knows it (absent for a draft). */
  session?: Pick<SessionInfo, "agent" | "model">
  agents: Agent[]
  /** The location's agent catalog has loaded. */
  agentsLoaded: boolean
  catalog: ProviderListResponse
  catalogLoaded: boolean
  config?: ConfigEntry[]
  prefs: Pick<ModelPreferences, "visibility" | "recent" | "variant" | "isReady">
  showCustomAgents: boolean
  /** The agent a draft keeps when none is chosen (the first of the list). */
  draftAgent?: string
  /** #562: the model of the last session on this server — the window's and the console's. */
  lastSession?: ModelKey
}

/** The model the location's config names, if any. */
export function configuredModel(config: ConfigEntry[] | undefined) {
  const entry = config?.findLast((item) => item.type === "document" && item.info.model !== undefined)
  const model = entry?.type === "document" ? entry.info.model : undefined
  if (!model) return
  if (typeof model !== "string") return { providerID: model.providerID, modelID: model.model, variant: model.variant }
  const [providerID = "", ...parts] = model.split("/")
  return { providerID, modelID: parts.join("/"), variant: undefined }
}

export function resolveSelection(input: SelectionInput) {
  const agents = input.agents.filter((item) => item.mode !== "subagent" && !item.hidden)
  const visible = input.showCustomAgents || hasCustomAgent(agents)
  const connected = new Set(connectedProviders(input.catalog).map((provider) => provider.id))
  const valid = (model: ModelKey) => !!input.catalog.all.get(model.providerID)?.models[model.modelID] && connected.has(model.providerID)
  const models = catalogModels(input.catalog)
  const find = (key: ModelKey) => models.find((model) => model.id === key.modelID && model.provider.id === key.providerID)
  const configured = configuredModel(input.config)
  const configReady = input.config !== undefined

  const agent = resolveAgent(agents, input.scope?.agent ?? input.session?.agent ?? (visible ? input.draftAgent ?? agents[0]?.name : "build"))
  const sessionModel = () => {
    const session = input.session
    if (session?.agent && session.agent !== agent?.name) return
    return session?.model && { providerID: session.model.providerID, modelID: session.model.id }
  }
  const recent = () => input.prefs.recent().find(valid)
  // Buff first (#562): without a recent pick the organization's models are the default; otherwise
  // a well-known vendor's model, not an aggregator's first catalog entry (BuffModelDefault).
  const fallback = () => {
    const buff = Object.values(input.catalog.all.get(BUFF_PROVIDER)?.models ?? {})[0]
    if (buff && valid({ providerID: BUFF_PROVIDER, modelID: buff.id })) return { providerID: BUFF_PROVIDER, modelID: buff.id }
    const chosen = BuffModelDefault.pick(
      connectedProviders(input.catalog).flatMap((provider) =>
        Object.values(provider.models)
          .filter((model) => valid({ providerID: provider.id, modelID: model.id }))
          .map((model) => ({
            providerID: provider.id,
            id: model.id,
            released: model.release_date,
            tools: model.capabilities.toolcall,
          })),
      ),
    )
    return chosen && { providerID: chosen.providerID, modelID: chosen.id }
  }
  const pick = [
    () => input.scope?.model,
    sessionModel,
    () => agent?.model,
    () => configured,
    recent,
    () => input.lastSession,
    fallback,
  ]
    .map((read) => read())
    .find((item): item is ModelKey => !!item && valid(item))
  const model = configReady && pick ? find(pick) : undefined

  const variants = model?.variants ? Object.keys(model.variants) : []
  const selected = () => {
    const scope = input.scope
    if (scope?.model && valid(scope.model)) return scope.variant
    const session = input.session
    if (session?.agent && session.agent !== agent?.name) return
    const value = session?.model
    if (value && valid({ providerID: value.providerID, modelID: value.id })) return value.variant ?? null
  }
  const configuredVariant = () => {
    if (!agent || !model) return
    const target = { providerID: model.provider.id, modelID: model.id, variants: model.variants }
    return (
      getConfiguredAgentVariant({ agent: { model: agent.model, variant: agent.variant }, model: target }) ??
      getConfiguredAgentVariant({ agent: { model: configured, variant: configured?.variant }, model: target })
    )
  }
  const variant = resolveModelVariant({
    variants,
    selected: selected(),
    configured: configuredVariant(),
    preferred: model ? input.prefs.variant({ providerID: model.provider.id, modelID: model.id }) : undefined,
  })
  const latest = latestModels(models)
  const shown = (item: CatalogModel) =>
    modelVisible(item, input.prefs.visibility({ providerID: item.provider.id, modelID: item.id }), latest)
  return {
    agents,
    /** Agents an @-mention can hand work to. */
    subagents: input.agents.filter((item) => !item.hidden && item.mode !== "primary"),
    agentsVisible: visible,
    agent,
    model,
    variant,
    variants,
    /** Every model of the connected providers. */
    all: models,
    /** Models the picker lists. */
    listed: models.filter(shown),
    paid: paidProviders(input.catalog).length > 0,
    loading:
      !input.prefs.isReady() || !configReady || (visible && !input.agentsLoaded) || !input.catalogLoaded,
    valid,
  }
}

export type Selection = ReturnType<typeof resolveSelection>

/** The state a session's or draft's pick becomes after choosing a model. */
export function chooseModel(selection: Selection, scope: SelectionState | undefined, item: ModelKey | undefined) {
  const previous = selection.model
  const same = item && previous?.provider.id === item.providerID && previous.id === item.modelID
  return {
    ...scope,
    agent: selection.agent?.name,
    model: item,
    variant: same ? (selection.variant ?? null) : undefined,
  } satisfies SelectionState
}

export function chooseVariant(selection: Selection, scope: SelectionState | undefined, value: string | undefined) {
  const model = selection.model
  if (!model) return scope
  return {
    ...scope,
    agent: selection.agent?.name,
    model: { providerID: model.provider.id, modelID: model.id },
    variant: value ?? null,
  } satisfies SelectionState
}

/** Switching agents remembers the model each agent last used. */
export function chooseAgent(selection: Selection, scope: SelectionState | undefined, name: string) {
  const item = resolveAgent(selection.agents, name)
  if (!item || item.name === selection.agent?.name) return scope
  const previous = selection.agent?.name
  const current = selection.model
  const choices = {
    ...scope?.choices,
    ...(previous
      ? {
          [previous]: {
            model: current ? { providerID: current.provider.id, modelID: current.id } : undefined,
            variant: current ? (selection.variant ?? null) : undefined,
          },
        }
      : {}),
  }
  return {
    agent: item.name,
    model: choices[item.name]?.model,
    variant: choices[item.name]?.variant,
    choices,
  } satisfies SelectionState
}

export function nextVariant(selection: Selection) {
  if (selection.variants.length === 0) return
  return cycleModelVariant({ variants: selection.variants, selected: selection.variant ?? null, configured: undefined })
}

export function cycleAgent(selection: Selection, direction: 1 | -1) {
  const items = selection.agents
  if (items.length === 0) return
  const index = items.findIndex((item) => item.name === selection.agent?.name) + direction
  return items[(index + items.length) % items.length]?.name
}

/** Whether the server's session already carries this pick (then the local pick can be dropped). */
export function sameSelection(a: SelectionState, b: SelectionState) {
  return (
    a.agent === b.agent &&
    a.model?.providerID === b.model?.providerID &&
    a.model?.modelID === b.model?.modelID &&
    (a.variant ?? "default") === (b.variant ?? "default")
  )
}

/**
 * The service moved the session to another agent on its own — an approved plan hands the work
 * back to the main agent: the kept pick's agent gives way, so the composer shows (and the next
 * send keeps) the agent the session is in. The models chosen per agent stay. A pick this
 * composer just sent and still waits to see confirmed is left to that confirmation.
 */
export function followServerAgent(
  kept: SelectionState | undefined,
  server: string | undefined,
  expected: SelectionState | undefined,
): SelectionState | undefined {
  if (!kept?.agent || !server || kept.agent === server || expected?.agent === server) return kept
  const { agent: _replaced, ...rest } = kept
  return rest
}
