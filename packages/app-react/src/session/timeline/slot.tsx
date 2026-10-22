import { PlaceholderHeader } from "../layout-slots"
import { loadScreenModules } from "../screen-modules"
import { lazySlot, type SessionSlot } from "../slots"

// The timeline draws its title row inside its own scroller (sticky, as the Solid window does), so
// the header slot holds an empty entry that keeps the layout's default title away.
export default [
  { slot: "header", id: "timeline-header", component: () => null },
  {
    slot: "timeline",
    id: "timeline",
    // Until the timeline's module is in, the session still shows its title (as text: the
    // editable heading comes with the timeline's title row).
    ...lazySlot(
      async () => (await loadScreenModules())[0],
      (module) => module.TimelineScreen,
      PlaceholderHeader,
    ),
  },
] satisfies SessionSlot[]
