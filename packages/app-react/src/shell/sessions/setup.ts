// Setup mode in the sessions column (#775/#860), as in the Solid window: the Setup section's «+»
// asks the core for a new setup session and shows it as a tab; a setup session the model opened
// from a session of this window is shown too, and every opening refreshes the list.

import type { OpenCodeClient, SessionInfo } from "@opencode/client/promise"
import { BuffSetup } from "@opencode/schema/buff-setup"

type Show = (session: SessionInfo) => void

/** A new setup session: the core creates it, the window opens it (it may not know it yet). */
export async function openSetupSession(api: OpenCodeClient, show: Show): Promise<void> {
  const result = await api.rpc(BuffSetup.Rpc).open({})
  show(await api.session.get({ sessionID: result.session }))
}

/** Follow `opened` until `signal` aborts: refresh on each, show the ones opened from a known session. */
export async function followSetupOpened(
  api: OpenCodeClient,
  input: { signal: AbortSignal; known: (sessionID: string) => boolean; refresh: () => void; show: Show },
): Promise<void> {
  for await (const event of api.rpc(BuffSetup.Rpc).events.subscribe("opened", { signal: input.signal })) {
    input.refresh()
    const from = event.data.from
    if (from && input.known(from))
      await api.session.get({ sessionID: event.data.session }).then(input.show, () => undefined)
  }
}
