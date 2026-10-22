// Line comments over one diff (#584): which line is selected, which comment is open or edited and
// the draft — the Solid createLineCommentControllerV2 — as a React hook. Pierre asks for each
// annotation's host element; the hook keeps one detached host per annotation key and portals the
// comment or the editor into it, so Pierre can move the host without React re-rendering it.

import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs"
import { createHoverCommentUtility } from "@opencode/session-ui/pierre/comment-hover"
import {
  cloneSelectedLineRange,
  formatSelectedLineLabel,
  lineInSelectedRange,
} from "@opencode/session-ui/pierre/selection-bridge"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { LineComment } from "../../../core/prompt-context"
import { useI18n } from "../../../i18n/provider"
import { LineCommentCard, LineCommentEditor, type Mention } from "./line-comment"

export type CommentMeta = { kind: "comment"; key: string; comment: LineComment } | { kind: "draft"; key: string; range: SelectedLineRange }

type Note = {
  opened: string | null
  selected: SelectedLineRange | null
  commenting: SelectedLineRange | null
  draft: string
  editing: string | null
}

const clone = (range: SelectedLineRange | null) => (range ? cloneSelectedLineRange(range) : null)
const line = (range: SelectedLineRange) => Math.max(range.start, range.end)

export function useLineComments(input: {
  file: string
  comments: LineComment[]
  enabled: boolean
  side: (range: SelectedLineRange) => "additions" | "deletions"
  onSubmit: (comment: string, selection: SelectedLineRange) => void
  onUpdate: (id: string, comment: string, selection: SelectedLineRange) => void
  onDelete: (comment: LineComment) => void
  actions?: (comment: LineComment, controls: { edit: () => void; remove: () => void }) => ReactNode
  mention?: Mention
  /** The review's editors, labelled as the Solid session review labels them. */
  review?: boolean
}) {
  const i18n = useI18n()
  const [note, setNote] = useState<Note>({ opened: null, selected: null, commenting: null, draft: "", editing: null })
  const hosts = useRef(new Map<string, HTMLDivElement>())
  const latest = useRef({ note, input })
  latest.current = { note, input }
  const label = (range: SelectedLineRange) =>
    formatSelectedLineLabel(range, (key, params) => i18n.t(key, params))

  const patch = (next: Partial<Note>) => setNote((current) => ({ ...current, ...next }))
  const openDraft = (range: SelectedLineRange) =>
    patch({ draft: "", editing: null, opened: null, selected: clone(range), commenting: clone(range) })
  const cancelDraft = () => patch({ draft: "", editing: null, commenting: null })

  const annotations = useMemo<DiffLineAnnotation<CommentMeta>[]>(() => {
    const list: DiffLineAnnotation<CommentMeta>[] = input.comments.map((comment) => ({
      side: input.side(comment.selection),
      lineNumber: line(comment.selection),
      metadata: { kind: "comment", key: `comment:${comment.id}`, comment },
    }))
    if (!note.commenting) return list
    return [
      ...list,
      {
        side: input.side(note.commenting),
        lineNumber: line(note.commenting),
        metadata: { kind: "draft", key: `draft:${input.file}`, range: note.commenting },
      },
    ]
  }, [input.comments, note.commenting, input.file, input.side])

  // Hosts of annotations that left the list are dropped with their portals.
  useEffect(() => {
    const keep = new Set(annotations.map((annotation) => annotation.metadata.key))
    for (const key of hosts.current.keys()) if (!keep.has(key)) hosts.current.delete(key)
  }, [annotations])

  const host = (key: string) => {
    const known = hosts.current.get(key)
    if (known) return known
    const created = document.createElement("div")
    created.setAttribute("data-prevent-autofocus", "")
    hosts.current.set(key, created)
    return created
  }

  const renderAnnotation = (annotation: { metadata?: unknown }) => {
    const meta = annotation.metadata as CommentMeta | undefined
    if (!meta) return
    return host(meta.key)
  }

  const renderGutterUtility = (hovered: () => { lineNumber: number; side?: "additions" | "deletions" } | undefined) =>
    createHoverCommentUtility({
      label: i18n.t("ui.lineComment.submit"),
      getHoveredLine: hovered,
      onSelect: (target) => {
        const current = latest.current.note.opened ? null : latest.current.note.selected
        if (current && lineInSelectedRange(current, target.lineNumber, target.side)) return openDraft(current)
        const range: SelectedLineRange = { start: target.lineNumber, end: target.lineNumber }
        if (target.side) range.side = target.side
        openDraft(range)
      },
    })

  const portals = annotations.map((annotation) => {
    const meta = annotation.metadata
    const target = host(meta.key)
    if (meta.kind === "draft") {
      return createPortal(
        <div data-prevent-autofocus="" onMouseDown={(event) => event.stopPropagation()}>
          <LineCommentEditor
            value={note.draft}
            selection={label(meta.range)}
            onInput={(draft) => patch({ draft })}
            onCancel={() => patch({ draft: "", editing: null, commenting: null, selected: null })}
            onSubmit={(comment) => {
              input.onSubmit(comment, cloneSelectedLineRange(meta.range))
              patch({ draft: "", editing: null, commenting: null, selected: null })
            }}
            mention={input.mention}
            review={input.review}
          />
        </div>,
        target,
        meta.key,
      )
    }
    const comment = meta.comment
    const edit = () =>
      patch({ opened: null, selected: clone(comment.selection), commenting: null, editing: comment.id, draft: comment.comment })
    const remove = () => {
      patch({ draft: "", editing: null, opened: null, selected: null, commenting: null })
      input.onDelete(comment)
    }
    if (note.editing === comment.id) {
      return createPortal(
        <div data-prevent-autofocus="" data-comment-id={comment.id} onMouseDown={(event) => event.stopPropagation()}>
          <LineCommentEditor
            value={note.draft}
            selection={label(comment.selection)}
            onInput={(draft) => patch({ draft })}
            onCancel={cancelDraft}
            onSubmit={(value) => {
              input.onUpdate(comment.id, value, cloneSelectedLineRange(comment.selection))
              cancelDraft()
            }}
            submitLabel={i18n.t("common.save")}
            mention={input.mention}
            review={input.review}
          />
        </div>,
        target,
        meta.key,
      )
    }
    return createPortal(
      <div
        data-prevent-autofocus=""
        data-comment-id={comment.id}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseEnter={() => {
          if (!latest.current.note.commenting) patch({ selected: clone(comment.selection) })
        }}
        onClick={() =>
          setNote((current) => ({
            ...current,
            opened: current.opened === comment.id ? null : comment.id,
            selected: clone(comment.selection),
          }))
        }
      >
        <LineCommentCard
          comment={comment.comment}
          selection={label(comment.selection)}
          actions={input.actions?.(comment, { edit, remove })}
        />
      </div>,
      target,
      meta.key,
    )
  })

  return {
    note,
    annotations,
    portals,
    renderAnnotation,
    renderGutterUtility: input.enabled ? renderGutterUtility : undefined,
    commentedLines: useMemo(() => input.comments.map((comment) => comment.selection), [input.comments]),
    select: (range: SelectedLineRange | null) => patch({ selected: clone(range) }),
    open: (id: string, range: SelectedLineRange) => patch({ opened: id, selected: clone(range) }),
    onLineSelected: (range: SelectedLineRange | null) => {
      if (!input.enabled) return
      if (!range) return patch({ selected: null, draft: "", editing: null, commenting: null })
      patch({ selected: clone(range) })
    },
    onLineSelectionEnd: (range: SelectedLineRange | null) => {
      if (!input.enabled) return
      if (!range) return cancelDraft()
      openDraft(range)
    },
    onLineNumberSelectionEnd: (range: SelectedLineRange | null) => {
      if (range) openDraft(range)
    },
  }
}
