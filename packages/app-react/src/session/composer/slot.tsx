import { loadScreenModules } from "../screen-modules"
import { lazySlot, type SessionSlot } from "../slots"

export default [
  {
    slot: "composer",
    id: "composer",
    ...lazySlot(
      async () => (await loadScreenModules())[1],
      (module) => module.SessionComposer,
    ),
  },
  {
    slot: "chat-overlay",
    id: "composer-dropzone",
    ...lazySlot(
      () => import("./dropzone"),
      (module) => module.Dropzone,
    ),
  },
] satisfies SessionSlot[]
