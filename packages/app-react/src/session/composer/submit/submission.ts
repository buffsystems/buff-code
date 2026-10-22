// One send of the composer (#584), ported from the Solid composer's submission state
// (submission-state.ts): it remembers what was sent and where, clears the draft, and can put the
// prompt back if the send fails — into the draft it came from, or into the session draft a new
// session promoted it to.

import { appendPrompt, clonePrompt, isAttachment } from "@opencode/app/react-reuse/composer-prompt-parts"
import type { ContextItem, Prompt } from "@opencode/app/react-reuse/composer-schema"
import type { ComposerDraft } from "../draft/draft"

export type SubmissionContext = (ContextItem & { key: string })[]

export function createSubmission(input: { target: ComposerDraft; prompt: Prompt; context: SubmissionContext }) {
  const initial = input.target
  const state = {
    target: input.target,
    cleared: undefined as Prompt | undefined,
    following: undefined as Prompt | undefined,
    preserveDraft: false,
  }
  return {
    prompt: input.prompt,
    context: input.context,
    target: () => state.target,
    clear() {
      if (initial !== state.target) {
        initial.reset()
        // A preparing session may already hold an unsent follow-up in its promoted draft.
        const current = state.target.current()
        if (state.preserveDraft && current.some((part) => isAttachment(part) || part.content.length > 0))
          state.following = clonePrompt(current)
      }
      if (!state.following) state.target.reset()
      state.cleared = state.target.current()
    },
    retarget(next: ComposerDraft, options?: { preserveDraft?: boolean }) {
      input.context.forEach((item) => next.context.add(item))
      state.target = next
      state.preserveDraft = options?.preserveDraft ?? false
    },
    current: (draft: ComposerDraft) => state.target === draft,
    restore() {
      if (state.cleared !== undefined && state.target.current() !== state.cleared) return
      return {
        target: state.target,
        prompt: state.following ? appendPrompt(input.prompt, state.following) : input.prompt,
        context: input.context,
      }
    },
  }
}

export type Submission = ReturnType<typeof createSubmission>
