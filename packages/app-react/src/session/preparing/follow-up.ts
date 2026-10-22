// The follow-up typed while a session is being prepared (#584): a new worktree is created before
// the session exists, so what the person types meanwhile lives in memory per pending tab — as the
// Solid tabs' memory composer — and moves into the session's draft once it exists, or back into
// the draft tab after its first prompt if the session is never made.

import { appendPrompt, promptLength } from "@opencode/app/react-reuse/composer-prompt-parts"
import { createComposerDraft, type ComposerDraft } from "../composer/draft/draft"
import type { PlatformStorage } from "../../platform/platform"

const drafts = new Map<string, ComposerDraft>()

function memory(): PlatformStorage {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  }
}

/** The pending tab's follow-up draft, kept while the tab is pending (also when it is closed and back). */
export function followUpDraft(tabKey: string) {
  const existing = drafts.get(tabKey)
  if (existing) return existing
  const storage = memory()
  const created = createComposerDraft({ host: { storage: () => storage }, target: { key: "follow-up" } })
  drafts.set(tabKey, created)
  return created
}

/** The session exists: its draft takes the follow-up, when there is one. */
export function moveFollowUp(tabKey: string, target: ComposerDraft) {
  const draft = drafts.get(tabKey)
  drafts.delete(tabKey)
  if (!draft || promptLength(draft.current()) === 0) return
  target.set(draft.current(), draft.cursor())
}

/** The session was never made: the draft tab gets its first prompt and the follow-up after it. */
export function restoreFollowUp(tabKey: string, original: ComposerDraft) {
  const draft = drafts.get(tabKey)
  drafts.delete(tabKey)
  if (!draft || promptLength(draft.current()) === 0) return
  const restored = appendPrompt(original.current(), draft.current())
  original.set(restored, promptLength(restored))
}
