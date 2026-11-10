// The composer and its dropzone on the new-session draft screen (#584); the composer itself lives
// in src/session/composer.
// #847: lazySlot comes straight from its module — new-session/slots gathers this file eagerly.
import type { DraftSlot } from "../new-session/slots"
import { lazySlot } from "../react/lazy-slot"

export default [
  {
    slot: "composer",
    id: "composer",
    ...lazySlot(
      () => import("../session/composer/draft-composer"),
      (module) => module.DraftComposer,
    ),
  },
  {
    slot: "surface",
    id: "composer-dropzone",
    ...lazySlot(
      () => import("../session/composer/dropzone"),
      (module) => module.Dropzone,
    ),
  },
] satisfies DraftSlot[]
