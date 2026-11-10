// The sessions column's rows (#584): a session with its label and time, and — for Setup mode
// (#775/#860) — whether it is a setup session; BuffSessionMarks.sections gives those their own section.

import type { SessionInfo } from "@opencode/client/promise"
import { BuffSetup } from "@opencode/schema/buff-setup"

export type Row = { id: string; title: string; updated: number; setup: boolean; session: SessionInfo }

export function sessionRows(sessions: readonly SessionInfo[], label: (session: SessionInfo) => string): Row[] {
  return sessions.map((session) => ({
    id: session.id,
    title: label(session),
    updated: session.time.updated ?? session.time.created,
    setup: BuffSetup.isSetup(session),
    session,
  }))
}
