// The side panes' prompt context in the composer (#584): review line comments and file selections
// the panes stage in core/prompt-context.ts show in the session's draft and go with the next send,
// as the Solid review writes into the composer's prompt.context. The draft keeps its own
// persisted copy (it survives a restart and a failed send); this mirrors the panes' changes into
// it and hands the composer's removals and sends back.

import { contextItemKey, type FileContextItem } from "@opencode/app/react-reuse/composer-schema"
import type { PromptHistoryComment } from "@opencode/app/react-reuse/composer-history-entry"
import { useEffect } from "react"
import { contextKey, promptContext, type FileContextItem as PaneItem } from "../../core/prompt-context"
import type { ComposerDraft } from "./draft/draft"

/** Mirror the panes' context items of a session into its draft while it is shown. */
export function mirrorPromptContext(draft: ComposerDraft, key: string) {
  const known = { items: [] as PaneItem[] }
  const sync = () => {
    const next = promptContext.read(key).context
    if (next === known.items) return
    const before = new Map(known.items.map((item) => [contextKey(item), item]))
    const after = new Map(next.map((item) => [contextKey(item), item]))
    known.items = next
    before.forEach((item, id) => {
      if (!after.has(id)) draft.context.remove(contextItemKey(item))
    })
    after.forEach((item, id) => {
      const previous = before.get(id)
      if (previous === item) return
      if (previous && item.commentID) return draft.context.updateComment(item.path, item.commentID, item)
      draft.context.add(item)
    })
  }
  sync()
  return promptContext.store.subscribe(sync)
}

export function usePromptContextMirror(draft: ComposerDraft, key: string | undefined) {
  useEffect(() => (key ? mirrorPromptContext(draft, key) : undefined), [draft, key])
}

/** The composer's side of the bridge for one session. */
export function promptContextActions(key: string) {
  return {
    /** A chip removed in the composer leaves the panes too. */
    remove(item: FileContextItem) {
      if (item.commentID) {
        promptContext.comments.remove(key, item.path, item.commentID)
        promptContext.context.removeComment(key, item.path, item.commentID)
        return
      }
      promptContext.context.remove(key, contextKey(item))
    },
    /** A sent prompt took its comments with it. */
    clear(items: FileContextItem[]) {
      items.forEach((item) => {
        if (!item.commentID) return
        promptContext.comments.remove(key, item.path, item.commentID)
        promptContext.context.removeComment(key, item.path, item.commentID)
      })
    },
    focus(item: FileContextItem) {
      if (item.commentID) promptContext.comments.setFocus(key, { file: item.path, id: item.commentID })
    },
  }
}

/** The draft's comments as prompt history keeps them. */
export function historyComments(items: readonly (FileContextItem & { key: string })[]): PromptHistoryComment[] {
  return items.flatMap((item) => {
    const comment = item.comment?.trim()
    if (!comment || !item.selection) return []
    return [
      {
        id: item.commentID ?? item.key,
        path: item.path,
        selection: { start: item.selection.startLine, end: item.selection.endLine },
        comment,
        time: Date.now(),
        origin: item.commentOrigin,
        preview: item.preview,
      },
    ]
  })
}
