// The window's open composer drafts (#584): one draft per session or new-session tab, kept while
// the person switches tabs so a half-typed prompt and its caret survive, the most recent twenty
// in memory (as the Solid window's composer cache). Every draft is also persisted.

import { createComposerDraft, type ComposerDraft } from "./draft"
import type { DocumentHost } from "./document"
import { draftPromptTarget, sessionPromptTarget } from "./target"

const MAX_DRAFTS = 20

export type DraftScope =
  | { type: "session"; scope: string; directory: string; sessionID: string }
  | { type: "draft"; draftID: string }

// A session's open draft follows the session, not its directory: a session moved to another
// worktree keeps what is being typed (the Solid window holds it on the session's tab). The
// directory only picks where a new draft is persisted. A reader that does not know the session's
// directory yet gets its own draft, so the real one is never taken from an empty place.
export function draftKey(scope: DraftScope) {
  if (scope.type === "draft") return `draft:${scope.draftID}`
  if (!scope.directory) return JSON.stringify([scope.scope, "", scope.sessionID])
  return JSON.stringify([scope.scope, scope.sessionID])
}

export function createDraftRegistry(host: DocumentHost) {
  const drafts = new Map<string, ComposerDraft>()
  return {
    get(scope: DraftScope) {
      const key = draftKey(scope)
      const existing = drafts.get(key)
      if (existing) {
        drafts.delete(key)
        drafts.set(key, existing)
        return existing
      }
      const target =
        scope.type === "draft"
          ? draftPromptTarget(scope.draftID)
          : sessionPromptTarget(scope.scope, scope.directory, scope.sessionID)
      const created = createComposerDraft({ host, target })
      drafts.set(key, created)
      while (drafts.size > MAX_DRAFTS) {
        const oldest = drafts.keys().next().value
        if (oldest === undefined) break
        drafts.get(oldest)?.flush()
        drafts.delete(oldest)
      }
      return created
    },
  }
}

export type DraftRegistry = ReturnType<typeof createDraftRegistry>

const perWindow = new WeakMap<DocumentHost["storage"], DraftRegistry>()

export function draftRegistry(host: DocumentHost) {
  const existing = perWindow.get(host.storage)
  if (existing) return existing
  const created = createDraftRegistry(host)
  perWindow.set(host.storage, created)
  return created
}
