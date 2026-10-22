// What the side panes hand the composer (#584): each session's line comments (the review's notes
// on changed lines) and the prompt context items they stage — the Solid window's comments store and
// prompt.context, framework-free. The review writes here; the composer reads the context items,
// shows them as chips and sends them with the next message. Keyed by the Solid window's session
// state key.

import { createStore } from "./store"

export type LineRange = { start: number; end: number; side?: "additions" | "deletions"; endSide?: "additions" | "deletions" }
export type FileSelection = { startLine: number; startChar: number; endLine: number; endChar: number }

export type LineComment = { id: string; file: string; selection: LineRange; comment: string; time: number }

export type FileContextItem = {
  type: "file"
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export type CommentFocus = { file: string; id: string }

type SessionContext = { comments: LineComment[]; context: FileContextItem[]; focus: CommentFocus | null }

const EMPTY: SessionContext = { comments: [], context: [], focus: null }

export function selectionFromLines(range: LineRange): FileSelection {
  return {
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
    startChar: 0,
    endChar: 0,
  }
}

/** A context item's identity: one per file, selection and comment. */
export function contextKey(item: FileContextItem) {
  const range = item.selection ? `${item.selection.startLine}-${item.selection.endLine}` : ""
  return `file:${item.path}:${range}:${item.commentID ?? ""}`
}

export function createPromptContext(newID: () => string = () => crypto.randomUUID(), now: () => number = Date.now) {
  const store = createStore<Record<string, SessionContext>>({})
  const read = (key: string) => store.get()[key] ?? EMPTY
  const edit = (key: string, change: (session: SessionContext) => SessionContext) =>
    store.set((all) => ({ ...all, [key]: change(all[key] ?? EMPTY) }))

  return {
    store,
    read,
    comments: {
      add(key: string, input: Omit<LineComment, "id" | "time">) {
        const comment: LineComment = { ...input, selection: { ...input.selection }, id: newID(), time: now() }
        edit(key, (session) => ({
          ...session,
          comments: [...session.comments, comment],
          focus: { file: comment.file, id: comment.id },
        }))
        return comment
      },
      update(key: string, file: string, id: string, comment: string) {
        edit(key, (session) => ({
          ...session,
          comments: session.comments.map((item) => (item.file === file && item.id === id ? { ...item, comment } : item)),
        }))
      },
      remove(key: string, file: string, id: string) {
        edit(key, (session) => ({
          ...session,
          comments: session.comments.filter((item) => !(item.file === file && item.id === id)),
          focus: session.focus?.file === file && session.focus.id === id ? null : session.focus,
        }))
      },
      setFocus(key: string, focus: CommentFocus | null) {
        edit(key, (session) => (session.focus === focus ? session : { ...session, focus }))
      },
    },
    context: {
      add(key: string, item: FileContextItem) {
        edit(key, (session) => {
          const id = contextKey(item)
          if (session.context.some((existing) => contextKey(existing) === id)) return session
          return { ...session, context: [...session.context, item] }
        })
      },
      remove(key: string, id: string) {
        edit(key, (session) => ({ ...session, context: session.context.filter((item) => contextKey(item) !== id) }))
      },
      updateComment(key: string, path: string, commentID: string, next: Partial<FileContextItem>) {
        edit(key, (session) => ({
          ...session,
          context: session.context.map((item) =>
            item.path === path && item.commentID === commentID ? { ...item, ...next } : item,
          ),
        }))
      },
      removeComment(key: string, path: string, commentID: string) {
        edit(key, (session) => ({
          ...session,
          context: session.context.filter((item) => !(item.path === path && item.commentID === commentID)),
        }))
      },
    },
  }
}

export type PromptContext = ReturnType<typeof createPromptContext>

/** The window's one instance: the panes add to it, the composer reads it. */
export const promptContext = createPromptContext()
