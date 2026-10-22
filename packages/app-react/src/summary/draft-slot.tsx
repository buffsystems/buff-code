// «Extensions» in the draft's «Session details» (#584): the server card under the project card,
// for where the session will run, with the draft's MCP switches.

import type { DraftSlot } from "../new-session/slots"
import { useDraft } from "../new-session/context"
import { ServerPanel } from "./server-panel"

function DraftServerPanel() {
  const draft = useDraft()
  return <ServerPanel server={draft.server} directory={draft.mcp.directory} mcp={draft.mcp} />
}

export default { slot: "summary", id: "summary-server", component: DraftServerPanel } satisfies DraftSlot
