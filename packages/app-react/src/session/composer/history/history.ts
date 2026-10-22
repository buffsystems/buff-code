// The prompt history the composer recalls with ↑/↓ (#584): the Solid window's two global
// histories (normal prompts and shell commands), kept in the draft store with their images.

import {
  clonePromptHistoryComments,
  prependHistoryEntry,
  removeHistoryEntry,
  type PromptHistoryComment,
} from "@opencode/app/react-reuse/composer-history-entry"
import { clonePrompt } from "@opencode/app/react-reuse/composer-prompt-parts"
import { PromptHistoryState, type Prompt } from "@opencode/app/react-reuse/composer-schema"
import { createPersistedDocument, type DocumentHost } from "../draft/document"
import { historyTarget } from "../draft/target"

type Mode = "normal" | "shell"

export function createPromptHistory(host: DocumentHost) {
  const documents = {
    normal: createPersistedDocument({ host, target: historyTarget("normal"), schema: PromptHistoryState, initial: { entries: [] } }),
    shell: createPersistedDocument({ host, target: historyTarget("shell"), schema: PromptHistoryState, initial: { entries: [] } }),
  }
  // A send before the history loaded applies once it has, so it is not lost under the stored list.
  const whenReady = (mode: Mode, run: () => void) => {
    if (documents[mode].isReady()) return run()
    void documents[mode].ready.then(run)
  }
  return {
    entries: (mode: Mode) => documents[mode].store.get().entries,
    add(prompt: Prompt, mode: Mode, comments: PromptHistoryComment[]) {
      const saved = clonePrompt(prompt)
      const metadata = clonePromptHistoryComments(comments)
      whenReady(mode, () =>
        documents[mode].set((state) => {
          const entries = prependHistoryEntry(state.entries, saved, metadata)
          return entries === state.entries ? state : { entries }
        }),
      )
    },
    remove(prompt: Prompt, mode: Mode, comments: PromptHistoryComment[]) {
      whenReady(mode, () =>
        documents[mode].set((state) => {
          const entries = removeHistoryEntry(state.entries, prompt, comments)
          return entries === state.entries ? state : { entries }
        }),
      )
    },
  }
}

export type PromptHistory = ReturnType<typeof createPromptHistory>

const perWindow = new WeakMap<DocumentHost["storage"], PromptHistory>()

/** One history per window. */
export function promptHistory(host: DocumentHost) {
  const existing = perWindow.get(host.storage)
  if (existing) return existing
  const created = createPromptHistory(host)
  perWindow.set(host.storage, created)
  return created
}
