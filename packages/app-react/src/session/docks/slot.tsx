import { lazySlot, type SessionSlot } from "../slots"

// The request docks sit right above the composer (order 0) in the composer slot.
export default {
  slot: "composer",
  id: "request-docks",
  order: -10,
  ...lazySlot(
    () => import("./docks"),
    (module) => module.SessionDocks,
  ),
} satisfies SessionSlot
