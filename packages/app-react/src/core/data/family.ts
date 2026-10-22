// The session family index (#584), ported from the Solid data layer's resolveRoot and
// registerSession, over immutable state.

import { withSession, type DataState } from "./state"

// Walk parentID upward through loaded session info to the family root. When a parent's info is
// missing, that missing ID is the furthest-known ancestor and is returned so orphan subtrees group
// under it until the parent arrives. A seen set guards against parent cycles.
export function resolveRoot(state: DataState, sessionID: string) {
  const seen = new Set([sessionID])
  let current = sessionID
  let parentID = state.session.info[sessionID]?.parentID
  while (parentID && !seen.has(parentID)) {
    seen.add(parentID)
    current = parentID
    parentID = state.session.info[parentID]?.parentID
  }
  return current
}

// Register one loaded session into the family index. Idempotent. When a tentative family keyed by
// sessionID exists (descendants arrived while its own info was absent) but sessionID turns out to
// have a parent, the orphan subtree folds into the resolved root's family.
export function registerSession(state: DataState, sessionID: string): DataState {
  if (!state.session.info[sessionID]) return state
  const rootID = resolveRoot(state, sessionID)
  return withSession(state, "family", (family) => {
    const orphans = sessionID !== rootID ? family[sessionID] : undefined
    const members = family[rootID] ?? []
    const merged = [...members, ...(orphans ?? []).filter((id) => !members.includes(id))]
    const withSelf = merged.includes(sessionID) ? merged : [...merged, sessionID]
    if (!orphans && withSelf.length === members.length && family[rootID]) return family
    const next = { ...family, [rootID]: withSelf }
    if (orphans) delete next[sessionID]
    return next
  })
}
