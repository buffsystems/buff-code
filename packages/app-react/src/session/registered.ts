// Every `src/session/*/slot.tsx` the bundler finds (#584). Outside Vite (bun test) there is no
// glob, and the layout is given its slots directly.

import { collectSlots, type SessionSlotModule } from "./slots"

const found = (): Record<string, SessionSlotModule> => {
  try {
    return import.meta.glob<SessionSlotModule>("./*/slot.tsx", { eager: true })
  } catch {
    return {}
  }
}

export const registeredSlots = collectSlots(Object.values(found()))

/**
 * Load every lazy slot's module (#584). The window calls it once idle, so the first session it
 * opens — from Home or the new session page — paints its title, transcript and composer at once
 * instead of an empty layout while those modules load.
 */
export function preloadSessionSlots(slots = registeredSlots) {
  Object.values(slots)
    .flat()
    .forEach((entry) => void entry.preload?.().catch(() => undefined))
}
