// The draft screen's named slots (#584): features contribute `src/<folder>/draft-slot.tsx` and
// the screen renders every entry of a slot. See README.md for the contract.

import type { ComponentType } from "react"

export { lazySlot } from "../react/lazy-slot"

export const DRAFT_SLOTS = ["composer", "above-composer", "surface", "project-bar", "project-bar-end", "summary"] as const

export type DraftSlotName = (typeof DRAFT_SLOTS)[number]

export type DraftSlot = {
  slot: DraftSlotName
  /** Unique across all entries; the React key and the error-boundary label. */
  id: string
  /** Ascending; entries of equal order sort by id. */
  order?: number
  component: ComponentType
  /** Loads a lazy component's module ahead of its first render (the window preloads it when idle). */
  preload?: () => Promise<unknown>
}

export type DraftSlotModule = { default: DraftSlot | readonly DraftSlot[] }

export type DraftSlots = Record<DraftSlotName, DraftSlot[]>

/** Group the contributed entries by slot, each slot in render order. */
export function collectDraftSlots(modules: readonly DraftSlotModule[]): DraftSlots {
  const entries = modules.flatMap((module) => (Array.isArray(module.default) ? module.default : [module.default]))
  const sorted = [...entries].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return Object.fromEntries(
    DRAFT_SLOTS.map((name) => [name, sorted.filter((entry) => entry.slot === name)]),
  ) as DraftSlots
}

// Every draft-slot.tsx under src/<folder>/ the bundler finds; outside Vite (bun test) there is no glob.
export function registeredDraftSlots() {
  const found = (): Record<string, DraftSlotModule> => {
    try {
      return import.meta.glob<DraftSlotModule>("../*/draft-slot.tsx", { eager: true })
    } catch {
      return {}
    }
  }
  return collectDraftSlots(Object.values(found()))
}

/** Load every lazy draft slot's module, so the new session page paints its composer at once (#584). */
export function preloadDraftSlots(slots: DraftSlots = registeredDraftSlots()) {
  Object.values(slots)
    .flat()
    .forEach((entry) => void entry.preload?.().catch(() => undefined))
}
