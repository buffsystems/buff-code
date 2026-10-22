import type { SessionInfo } from "@opencode/client/promise"
import { buffSessionLabel } from "@opencode/util/buff-session-label"

const pattern = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

// Buff (#470): служебное имя новой сессии — на языке окна («Новая сессия»).
export function sessionLabel(
  session: Pick<SessionInfo, "title" | "parentID">,
  t: (text: string) => string = (text) => text,
) {
  return buffSessionLabel(session, t)
}

export function sessionTitle(title?: string) {
  if (!title) return title
  const match = title.match(pattern)
  return match?.[1] ?? title
}
