// One composer draft (#584): the prompt, caret, mode, retry marker, model mirror and review-comment
// context of a session or a new-session tab, over a persisted document. A port of the Solid
// composer state (state.ts) and the editor's draft actions (editor/actions.ts) as plain functions.

import { isAttachment, promptLength, clonePrompt } from "@opencode/app/react-reuse/composer-prompt-parts"
import {
  ComposerStore,
  DEFAULT_PROMPT,
  contextItemKey,
  type AgentPart,
  type ContextItem,
  type FileAttachmentPart,
  type FileContextItem,
  type Prompt,
  type PromptModel,
  type SkillPart,
} from "@opencode/app/react-reuse/composer-schema"
import { createPersistedDocument, type DocumentHost, type DocumentTarget } from "./document"

export type ComposerDocument = ComposerStore
export type ComposerMode = "normal" | "shell"
export type ComposerRetry = NonNullable<ComposerStore["retry"]>
export type Mention = FileAttachmentPart | AgentPart | SkillPart

export function emptyComposer(): ComposerStore {
  return { prompt: clonePrompt(DEFAULT_PROMPT), context: { items: [] } }
}

export function isCommentItem(item: ContextItem) {
  return item.type === "file" && !!item.comment?.trim()
}

export function promptText(prompt: Prompt) {
  return prompt.map((part) => ("content" in part ? part.content : "")).join("")
}

export function createComposerDraft(input: { host: DocumentHost; target: DocumentTarget }) {
  const document = createPersistedDocument({
    host: input.host,
    target: input.target,
    schema: ComposerStore,
    initial: emptyComposer(),
  })
  const state = () => document.store.get()
  const set = document.set
  const edit = (update: Partial<ComposerStore>) => set((current) => ({ ...current, ...update }))
  const clearRetry = () => {
    if (state().retry !== undefined) edit({ retry: undefined })
  }
  const items = (update: (items: ComposerStore["context"]["items"]) => ComposerStore["context"]["items"]) => {
    set((current) => ({ ...current, context: { ...current.context, items: update(current.context.items) } }))
    clearRetry()
  }

  const draft = {
    store: document.store,
    ready: document.ready,
    isReady: document.isReady,
    flush: document.flush,
    state,
    current: () => state().prompt,
    cursor: () => state().cursor,
    mode: () => state().mode ?? "normal",
    retry: () => state().retry,
    model: () => state().model,
    contextItems: () => state().context.items,

    /** Replace the prompt (and the caret when given); a new prompt is never a retry. */
    set(prompt: Prompt, cursor?: number) {
      edit({ prompt: clonePrompt(prompt), ...(cursor !== undefined ? { cursor } : {}), retry: undefined })
    },
    reset() {
      edit({ prompt: clonePrompt(DEFAULT_PROMPT), cursor: 0, retry: undefined })
    },
    /** The editor's own write: its parsed prompt, kept without a copy. */
    setPrompt(prompt: Prompt, cursor?: number) {
      edit({ prompt, ...(cursor !== undefined ? { cursor } : {}), retry: undefined })
    },
    setCursor(cursor: number) {
      if (state().cursor === cursor) return
      edit({ cursor })
    },
    setMode(mode: ComposerMode) {
      if (state().mode === mode && state().retry === undefined) return
      edit({ mode, retry: undefined })
    },
    setRetry(retry: ComposerRetry) {
      edit({ retry })
    },
    setModel(model: PromptModel | undefined) {
      edit({ model })
      clearRetry()
    },
    setText(content: string) {
      edit({
        prompt: [{ type: "text", content, start: 0, end: content.length }, ...state().prompt.filter(isAttachment)],
        cursor: content.length,
        retry: undefined,
      })
    },
    addText(content: string) {
      const cursor = state().cursor ?? promptLength(state().prompt)
      edit({ prompt: insertText(state().prompt, cursor, content), cursor: cursor + content.length, retry: undefined })
    },
    addMention(mention: Mention, range?: { start: number; end: number }) {
      const text = promptText(state().prompt)
      const end = range?.end ?? state().cursor ?? text.length
      const start = range?.start ?? text.slice(0, end).lastIndexOf("@")
      const from = start < 0 ? end : start
      edit({ prompt: insertMention(state().prompt, from, end, mention), cursor: from + mention.content.length + 1 })
      clearRetry()
    },
    /** A mention at the end of the text, after a space: a file the panes add to the chat. */
    appendMention(mention: Mention) {
      const text = promptText(state().prompt)
      const gap = text && !/\s$/.test(text) ? " " : ""
      const prompt = gap ? insertText(state().prompt, text.length, gap) : state().prompt
      const end = text.length + gap.length
      edit({ prompt: insertMention(prompt, end, end, mention), cursor: end + mention.content.length + 1 })
      clearRetry()
    },
    removeAttachment(id: string) {
      edit({ prompt: state().prompt.filter((part) => !isAttachment(part) || part.id !== id) })
      clearRetry()
    },
    context: {
      add(item: ContextItem) {
        const key = contextItemKey(item)
        if (state().context.items.some((entry) => entry.key === key)) return
        items((current) => [...current, { key, ...item }])
      },
      remove(key: string) {
        items((current) => current.filter((item) => item.key !== key))
      },
      removeComment(path: string, commentID: string) {
        items((current) =>
          current.filter((item) => !(item.type === "file" && item.path === path && item.commentID === commentID)),
        )
      },
      updateComment(path: string, commentID: string, next: Partial<FileContextItem>) {
        items((current) =>
          current.map((item) => {
            if (item.type !== "file" || item.path !== path || item.commentID !== commentID) return item
            const value = { ...item, ...next }
            return { ...value, key: contextItemKey(value) }
          }),
        )
      },
      replaceComments(next: FileContextItem[]) {
        items((current) => [
          ...current.filter((item) => !isCommentItem(item)),
          ...next.map((item) => ({ ...item, key: contextItemKey(item) })),
        ])
      },
    },
  }
  return draft
}

export type ComposerDraft = ReturnType<typeof createComposerDraft>

function insertText(prompt: Prompt, cursor: number, content: string): Prompt {
  let position = 0
  let inserted = false
  const parts = prompt.flatMap<Prompt[number]>((part) => {
    if (isAttachment(part)) return [part]
    const start = position
    position += part.content.length
    if (inserted) return [part]
    if (part.type === "text" && cursor >= start && cursor <= position) {
      inserted = true
      const offset = cursor - start
      return [{ ...part, content: part.content.slice(0, offset) + content + part.content.slice(offset) }]
    }
    if (cursor > start) return [part]
    inserted = true
    return [{ type: "text", content, start: 0, end: 0 }, part]
  })
  if (!inserted) parts.push({ type: "text", content, start: 0, end: 0 })
  return withOffsets(parts)
}

function insertMention(prompt: Prompt, start: number, end: number, mention: Mention): Prompt {
  if (start === 0 && end === 0) return withOffsets([mention, { type: "text", content: " ", start: 0, end: 0 }, ...prompt])
  let position = 0
  const parts = prompt.flatMap<Prompt[number]>((part) => {
    if (isAttachment(part)) return [part]
    const partStart = position
    position += part.content.length
    if (part.type !== "text" || start < partStart || end > position) return [part]
    const before = part.content.slice(0, start - partStart)
    const after = part.content.slice(end - partStart)
    return [
      ...(before ? [{ type: "text" as const, content: before, start: 0, end: 0 }] : []),
      mention,
      { type: "text" as const, content: ` ${after}`, start: 0, end: 0 },
    ]
  })
  return withOffsets(parts)
}

function withOffsets(prompt: Prompt): Prompt {
  let offset = 0
  return prompt.map((part) => {
    if (isAttachment(part)) return part
    const next = { ...part, start: offset, end: offset + part.content.length }
    offset = next.end
    return next
  })
}
