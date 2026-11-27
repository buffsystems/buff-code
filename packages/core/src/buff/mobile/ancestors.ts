// Buff (#969): the chats a helper's change also reaches. A helper (subagent) is a session of its own;
// its ask is shown in the chat that started it (R23-01), so a change in the helper must also go to
// whoever watches its parent, and up the chain. A session's parent never changes: it is asked once.

/** How deep helpers may nest before their asks stop climbing (as the state's own surfacing). */
export const MAX_DEPTH = 4

/** The parents of a session, nearest first, up to `depth`; a failed lookup ends the chain there. */
export function ancestry(parentOf: (session: string) => Promise<string | undefined>, depth = MAX_DEPTH) {
  const known = new Map<string, string | null>()
  const parent = async (session: string): Promise<string | undefined> => {
    if (known.has(session)) return known.get(session) ?? undefined
    const found = await parentOf(session).catch(() => undefined)
    known.set(session, found ?? null)
    return found
  }
  return async (session: string): Promise<string[]> => {
    const chain: string[] = []
    let at = session
    for (let i = 0; i < depth; i++) {
      const up = await parent(at)
      if (!up || chain.includes(up) || up === session) break
      chain.push(up)
      at = up
    }
    return chain
  }
}
