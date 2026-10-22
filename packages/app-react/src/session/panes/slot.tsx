// The side panes' slots (#584): the review toggle and the panes' commands over the panels, the
// review / files / browser panel on the side and the terminal at the bottom.

import type { SessionSlot } from "../slots"
import { PanelActions } from "./actions"
import { MobileChanges, MobileFiles, MobileUsage } from "./mobile"
import { SidePanel } from "./side-panel"
import { TerminalPanel } from "./terminal/panel"


export default [
  {
    slot: "panel-actions",
    id: "panes-actions",
    // Not lazy: its commands (Ctrl+` and the rest) must be registered as soon as the session shows.
    component: PanelActions,
  },
  {
    slot: "side",
    id: "panes-side",
    // Not lazy: a region opens and animates in the same commit as its pane, as in the Solid window.
    component: SidePanel,
  },
  {
    slot: "bottom",
    id: "panes-terminal",
    component: TerminalPanel,
  },
  { slot: "mobile-changes", id: "panes-mobile-changes", component: MobileChanges },
  { slot: "mobile-files", id: "panes-mobile-files", component: MobileFiles },
  { slot: "mobile-usage", id: "panes-mobile-usage", component: MobileUsage },
] satisfies SessionSlot[]
