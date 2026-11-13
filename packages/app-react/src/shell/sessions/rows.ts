// The sessions column's rows (#584): a session with its label and time, and — for Setup mode
// (#775/#860) — whether it is a setup session; BuffSessionMarks.sections gives those their own section.
// Recents (#922): only the sessions of the window's projects, each dated by its last message.

import type { SessionInfo } from "@opencode/client/promise"
import { BuffSetup } from "@opencode/schema/buff-setup"
import { homeProjectForSession, type HomeProject } from "../../home/model"

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

/** The rows of the window's projects; a removed project's sessions go. Setup mode spans the machine. */
export function inProjects(rows: readonly Row[], projects: readonly HomeProject[]): Row[] {
  return rows.filter((row) => row.setup || !!homeProjectForSession(row.session, projects))
}

/** When the last message came: the time today, the day this year, the full date before. */
export function lastMessageLabel(updated: number, now: number, locale: string): string {
  const date = new Date(updated)
  const today = new Date(now)
  if (date.toDateString() === today.toDateString())
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)
  const year = date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" as const }
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...year }).format(date)
}
