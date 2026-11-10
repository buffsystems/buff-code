// Buff's strips and chips on the new-session draft screen (#584); the same pieces the session
// composer mounts, see draft-strips.tsx.
// #847: lazySlot comes straight from its module — new-session/slots gathers this file eagerly.
import type { DraftSlot } from "../new-session/slots"
import { lazySlot } from "../react/lazy-slot"

const strips = () => import("./draft-strips")

export default [
  {
    slot: "above-composer",
    id: "buff-strips",
    ...lazySlot(strips, (module) => module.DraftStrips),
  },
  {
    slot: "project-bar",
    id: "buff-chips",
    ...lazySlot(strips, (module) => module.DraftChips),
  },
  {
    // After the workspace picker, at the end of the row, as in the Solid draft view.
    slot: "project-bar-end",
    id: "buff-balance",
    ...lazySlot(strips, (module) => module.DraftBalance),
  },
] satisfies DraftSlot[]
