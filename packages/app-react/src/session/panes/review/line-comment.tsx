// A line comment in a diff (#584): the shown note and its editor, the Solid LineComment and
// LineCommentEditor (v2) with their data slots, and an @-mention list of the workspace's files.

import { Button } from "@buff/ui/react"
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useI18n } from "../../../i18n/provider"

export function LineCommentCard(props: { comment: ReactNode; selection: ReactNode; actions?: ReactNode }) {
  return (
    <div data-component="line-comment-v2" data-variant="display">
      <div data-slot="line-comment-v2-shell">
        <div data-slot="line-comment-v2-column">
          <div data-slot="line-comment-v2-text">{props.comment}</div>
          <div data-slot="line-comment-v2-meta">{props.selection}</div>
        </div>
        {props.actions && <div data-slot="line-comment-v2-tools">{props.actions}</div>}
      </div>
    </div>
  )
}

export type Mention = { items: (query: string) => string[] | Promise<string[]> }

type MentionQuery = { query: string; start: number; end: number }

function currentMention(textarea: HTMLTextAreaElement): MentionQuery | undefined {
  if (textarea.selectionStart !== textarea.selectionEnd) return
  const end = textarea.selectionStart
  const match = textarea.value.slice(0, end).match(/@(\S*)$/)
  if (!match) return
  return { query: match[1] ?? "", start: end - match[0].length, end }
}

const directoryOf = (path: string) => {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return index === -1 ? "" : path.slice(0, index + 1)
}
const filenameOf = (path: string) => path.slice(directoryOf(path).length)

export function LineCommentEditor(props: {
  value: string
  selection: ReactNode
  onInput: (value: string) => void
  onCancel: () => void
  onSubmit: (value: string) => void
  cancelLabel?: string
  submitLabel?: string
  mention?: Mention
  /** The review's editor (the Solid session review's LineCommentEditor): «Commenting on line 2». */
  review?: boolean
}) {
  const i18n = useI18n()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [mentions, setMentions] = useState<{ items: string[]; active?: string }>({ items: [] })
  const query = useRef(0)
  const canSubmit = props.value.trim().length > 0

  useEffect(() => {
    const frame = requestAnimationFrame(() => textarea.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  const closeMention = () => setMentions({ items: [] })
  const syncMention = () => {
    const element = textarea.current
    const found = element && props.mention ? currentMention(element) : undefined
    if (!found || !found.query.trim()) return closeMention()
    const ticket = ++query.current
    void Promise.resolve(props.mention!.items(found.query)).then((items) => {
      if (ticket !== query.current) return
      setMentions({ items: items.slice(0, 10), active: items[0] })
    })
  }
  const selectMention = (path: string | undefined) => {
    const element = textarea.current
    const found = element ? currentMention(element) : undefined
    if (!path || !element || !found) return
    const value = `${element.value.slice(0, found.start)}@${path} ${element.value.slice(found.end)}`
    const cursor = found.start + path.length + 2
    props.onInput(value)
    closeMention()
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(cursor, cursor)
    })
  }
  const submit = () => {
    const value = props.value.trim()
    if (value) props.onSubmit(value)
  }
  const moveMention = (step: 1 | -1) => {
    const index = mentions.items.indexOf(mentions.active ?? "")
    const next = mentions.items[(index + step + mentions.items.length) % mentions.items.length]
    setMentions({ ...mentions, active: next })
  }

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation()
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (mentions.items.length > 0) {
      if (event.key === "Escape") {
        event.preventDefault()
        return closeMention()
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault()
        return selectMention(mentions.active ?? mentions.items[0])
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        return moveMention(event.key === "ArrowDown" ? 1 : -1)
      }
    }
    if (event.key === "Escape") {
      event.preventDefault()
      event.currentTarget.blur()
      return props.onCancel()
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div data-component="line-comment-v2" data-variant="editor">
      <div data-slot="line-comment-v2-shell">
        <div data-slot="line-comment-v2-field">
          <div data-slot="line-comment-v2-label">{i18n.t("ui.lineComment.submit")}</div>
          <textarea
            ref={textarea}
            data-slot="line-comment-v2-textarea"
            dir="auto"
            rows={3}
            placeholder={i18n.t("ui.lineComment.contextPlaceholder")}
            value={props.value}
            onChange={(event) => {
              props.onInput(event.currentTarget.value)
              syncMention()
            }}
            onClick={syncMention}
            onSelect={syncMention}
            onKeyDown={keyDown}
          />
          {mentions.items.length > 0 && (
            <div data-slot="line-comment-v2-mention-list" role="listbox">
              {mentions.items.map((path) => (
                <button
                  key={path}
                  type="button"
                  role="option"
                  aria-selected={mentions.active === path}
                  data-slot="line-comment-v2-mention-item"
                  data-active={mentions.active === path ? "" : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setMentions({ ...mentions, active: path })}
                  onClick={() => selectMention(path)}
                >
                  <span data-slot="line-comment-v2-mention-dir">{directoryOf(path)}</span>
                  <span data-slot="line-comment-v2-mention-file">{filenameOf(path)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div data-slot="line-comment-v2-footer">
          <div data-slot="line-comment-v2-footer-meta">
            {props.review ? (
              <span data-slot="line-comment-editor-label">
                {i18n.t("ui.lineComment.editorLabel.prefix")}
                {props.selection}
                {i18n.t("ui.lineComment.editorLabel.suffix")}
              </span>
            ) : (
              props.selection
            )}
          </div>
          <div data-slot="line-comment-v2-footer-actions">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-slot="line-comment-action"
              data-variant="ghost"
              onClick={props.onCancel}
            >
              {props.cancelLabel ?? i18n.t("ui.lineComment.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              data-slot="line-comment-action"
              data-variant="primary"
              disabled={!canSubmit}
              onClick={submit}
            >
              {props.submitLabel ?? i18n.t("ui.lineComment.submit")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
