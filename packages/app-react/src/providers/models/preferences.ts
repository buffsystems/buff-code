// The window's model preferences (#584): which models are shown or hidden, the recently used ones
// and the remembered variant per model — the Solid window's global "model" store
// (opencode.global.dat:model), shared by both windows. Settings, the model dialogs and the
// composer's picker read one store per window.

import { Persistence } from "@opencode/app/react-reuse/persistence-schema"
import { ModelState } from "@opencode/app/react-reuse/server-persistence"
import { Option, Schema } from "effect"
import { createPersisted } from "../../core/persisted"
import { createStore } from "../../core/store"
import type { PlatformStorage } from "../../platform/platform"
import { modelKey, type ModelKey } from "./catalog"

const RECENT_LIMIT = 5

export type ModelState = typeof ModelState.Type

const initial: ModelState = { user: [], recent: [], variant: {} }
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Persistence.withInitial(ModelState, initial)))

export function createModelPreferences(storage: (name: string) => PlatformStorage) {
  const cell = createPersisted<ModelState>({
    storage: storage("opencode.global.dat"),
    key: "model",
    decode: (raw) => Option.getOrUndefined(decode(raw)),
    initial,
  })
  // The composer's model resolution waits for the stored preferences before choosing a default.
  const loaded = createStore(false)
  void cell.ready.then(() => loaded.set(() => true))
  const state = () => cell.store.get()
  const variantKey = (model: ModelKey) => `${model.providerID}/${model.modelID}`
  return {
    store: cell.store,
    ready: cell.ready,
    isReady: () => loaded.get(),
    /** Becomes true once storage was read; components subscribe to it. */
    loaded,
    /** "show" / "hide" when the person chose; undefined leaves it to the catalog's defaults. */
    visibility(model: ModelKey) {
      return state().user.find((item) => item.providerID === model.providerID && item.modelID === model.modelID)
        ?.visibility
    },
    setVisibility(model: ModelKey, visible: boolean) {
      const visibility = visible ? ("show" as const) : ("hide" as const)
      cell.set((current) => {
        const index = current.user.findIndex(
          (item) => item.providerID === model.providerID && item.modelID === model.modelID,
        )
        if (index >= 0 && current.user[index]?.visibility === visibility) return current
        const user =
          index >= 0
            ? current.user.map((item, at) => (at === index ? { ...item, visibility } : item))
            : [...current.user, { ...model, visibility }]
        return { ...current, user }
      })
    },
    recent: () => state().recent,
    pushRecent(model: ModelKey) {
      cell.set((current) => {
        const seen = new Set<string>()
        const recent = [{ providerID: model.providerID, modelID: model.modelID }, ...current.recent]
          .filter((item) => {
            const key = modelKey(item)
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          .slice(0, RECENT_LIMIT)
        return { ...current, recent }
      })
    },
    variant: (model: ModelKey) => state().variant[variantKey(model)],
    setVariant(model: ModelKey, value: string | undefined) {
      cell.set((current) => ({ ...current, variant: { ...current.variant, [variantKey(model)]: value ?? "default" } }))
    },
  }
}

export type ModelPreferences = ReturnType<typeof createModelPreferences>

const perWindow = new WeakMap<(name: string) => PlatformStorage, ModelPreferences>()

/** One preferences store per window (per platform storage). */
export function modelPreferences(storage: (name: string) => PlatformStorage) {
  const existing = perWindow.get(storage)
  if (existing) return existing
  const created = createModelPreferences(storage)
  perWindow.set(storage, created)
  return created
}
