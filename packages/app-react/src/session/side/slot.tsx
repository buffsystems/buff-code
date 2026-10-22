// Side conversations (#464): their entry — the command, the «opened» event and the answer's
// selection actions — over the chat; the conversation itself is a tab of the side panel.

import type { SessionSlot } from "../slots"
import { SideEntry } from "./entry"

export default {
  slot: "chat-overlay",
  id: "side-entry",
  // Not lazy: the command and the «opened» event must be live as soon as the session shows.
  component: SideEntry,
} satisfies SessionSlot
