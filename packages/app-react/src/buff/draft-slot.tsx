// Buff's strips and chips on the new-session draft screen (#584); the same pieces the session
// composer mounts, see draft-strips.tsx.
import { lazySlot, type DraftSlot } from "../new-session/slots"

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
