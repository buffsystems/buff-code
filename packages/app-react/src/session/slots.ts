// The session screen's named slots (#584): features contribute a `slot.tsx` in their folder and
// the layout renders every entry of a slot. See README.md for the contract.

import type { ComponentType } from "react"

export { lazySlot } from "../react/lazy-slot"

export const SESSION_SLOTS = [
  "header",
  "timeline",
  "chat-overlay",
  "composer",
  "panel-actions",
  "side",
  "bottom",
  "mobile-changes",
  "mobile-files",
  "mobile-usage",
] as const

export type SessionSlotName = (typeof SESSION_SLOTS)[number]

export type SessionSlot = {
  slot: SessionSlotName
  /** Unique across all entries; the React key and the error-boundary label. */
  id: string
  /** Ascending; entries of equal order sort by id. */
  order?: number
  component: ComponentType
  /** Loads a lazy component's module ahead of its first render (the window preloads it when idle). */
  preload?: () => Promise<unknown>
}

export type SessionSlotModule = { default: SessionSlot | readonly SessionSlot[] }

export type SessionSlots = Record<SessionSlotName, SessionSlot[]>

/** Group the contributed entries by slot, each slot in render order. */
export function collectSlots(modules: readonly SessionSlotModule[]): SessionSlots {
  const entries = modules.flatMap((module) => (Array.isArray(module.default) ? module.default : [module.default]))
  const sorted = [...entries].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return Object.fromEntries(
    SESSION_SLOTS.map((name) => [name, sorted.filter((entry) => entry.slot === name)]),
  ) as SessionSlots
}

