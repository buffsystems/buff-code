// The composer and its dropzone on the new-session draft screen (#584); the composer itself lives
// in src/session/composer.
import { lazySlot, type DraftSlot } from "../new-session/slots"

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
