// One changed file in the review (#584): its header (status, name, folder, +/-) and its diff with
// line comments — the Solid SessionReviewFilePreviewV2. Images and audio show as media.

import { normalize, text, type ViewDiff } from "@opencode/session-ui/session-diff"
import { mediaKindFromPath } from "@opencode/session-ui/pierre/media"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import type { FileDiffInfo } from "@opencode/client/promise"
import type { SelectedLineRange } from "@pierre/diffs"
import { getDirectory, getFilename } from "@opencode/util/path"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@buff/ui/react"
import { Ellipsis } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import type { CommentFocus, LineComment } from "../../../core/prompt-context"
import { useI18n } from "../../../i18n/provider"
import { DiffChanges } from "../diff-changes"
import { FileIcon } from "../file-icon"
import type { ExpandMode, DiffStyle } from "../layout"
import { FileMedia, type ReadFile } from "../viewer/media"
import { DiffViewer } from "../viewer/viewer"
import { useLineComments, type CommentMeta } from "./comment-controller"
import type { Mention } from "./line-comment"

const LINE_THRESHOLD = 500

const statusLabel = (status: ViewDiff["status"]) => (status === "added" ? "A" : status === "deleted" ? "D" : "M")
const statusType = (status: ViewDiff["status"]) =>
  status === "added" ? "added" : status === "deleted" ? "deleted" : "modified"
const selectionSide = (range: SelectedLineRange) => range.endSide ?? range.side ?? "additions"

function selectionPreview(diff: ViewDiff, range: SelectedLineRange) {
  const contents = text(diff, selectionSide(range))
  if (contents.length === 0) return undefined
  return previewSelectedLines(contents, range)
}

export type ReviewCommentHandlers = {
  comments: LineComment[]
  focus: CommentFocus | null
  add: (input: { file: string; selection: SelectedLineRange; comment: string; preview?: string }) => void
  update: (input: { id: string; file: string; comment: string; preview?: string }) => void
  remove: (input: { id: string; file: string }) => void
  setFocus: (focus: CommentFocus | null) => void
}

export function ReviewFilePreview(props: {
  file: string
  diff: FileDiffInfo
  diffStyle: DiffStyle
  expandMode: ExpandMode
  readFile?: ReadFile
  comments?: ReviewCommentHandlers
  mention?: Mention
  /** Long lines wrap or scroll (a phone's «Wrap lines» setting); the viewer's default otherwise. */
  overflow?: "wrap" | "scroll"
  /** Without the file's own header row: a phone's accordion trigger already names the file. */
  bare?: boolean
}) {
  const i18n = useI18n()
  const scroll = useRef<HTMLDivElement>(null)
  const view = useMemo(() => normalize(props.diff), [props.diff])
  const canRender = view.additions !== 0 || view.deletions !== 0
  const media = mediaKindFromPath(props.file)
  const handlers = props.comments
  const fileComments = useMemo(
    () => (handlers?.comments ?? []).filter((comment) => comment.file === props.file),
    [handlers?.comments, props.file],
  )
  const comments = useLineComments({
    review: true,
    file: props.file,
    comments: fileComments,
    enabled: !!handlers,
    side: selectionSide,
    onSubmit: (comment, selection) =>
      handlers?.add({ file: props.file, selection, comment, preview: selectionPreview(view, selection) }),
    onUpdate: (id, comment, selection) =>
      handlers?.update({ id, file: props.file, comment, preview: selectionPreview(view, selection) }),
    onDelete: (comment) => handlers?.remove({ id: comment.id, file: props.file }),
    actions: (_, controls) => (
      <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger data-slot="line-comment-v2-overflow" aria-label={i18n.t("common.moreOptions")}>
            <Ellipsis aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={controls.edit}>{i18n.t("common.edit")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={controls.remove}>{i18n.t("common.delete")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
    mention: props.mention,
  })

  // A focused comment (from the composer's chip) opens here, scrolls into view and is handled once.
  const focus = handlers?.focus
  const setFocus = handlers?.setFocus
  useEffect(() => {
    if (!focus || !setFocus) return
    const frames: number[] = []
    const comment = fileComments.find((item) => item.id === focus.id)
    if (focus.file === props.file && comment) {
      comments.open(focus.id, cloneSelectedLineRange(comment.selection))
      const scrollTo = (attempt: number) => {
        const anchor = scroll.current?.querySelector(`[data-comment-id="${focus.id}"]`)
        if (anchor instanceof HTMLElement) return anchor.scrollIntoView({ block: "center" })
        if (attempt < 120) frames.push(requestAnimationFrame(() => scrollTo(attempt + 1)))
      }
      frames.push(requestAnimationFrame(() => scrollTo(0)))
    }
    frames.push(requestAnimationFrame(() => setFocus(null)))
    return () => frames.forEach((frame) => cancelAnimationFrame(frame))
    // Only a new focus is handled.
  }, [focus])

  const viewer = (
    <DiffViewer<CommentMeta>
      fileDiff={view.fileDiff}
      diffStyle={props.diffStyle}
      overflow={props.overflow}
      expandUnchanged={props.expandMode === "expand"}
      virtualize={Math.max(view.fileDiff.additionLines.length, view.fileDiff.deletionLines.length) > LINE_THRESHOLD}
      hunkSeparators={view.fileDiff.isPartial ? "simple" : "line-info-basic"}
      enableLineSelection={!!handlers}
      enableGutterUtility={!!handlers}
      onLineSelected={comments.onLineSelected}
      onLineSelectionEnd={comments.onLineSelectionEnd}
      onLineNumberSelectionEnd={comments.onLineNumberSelectionEnd}
      annotations={comments.annotations}
      renderAnnotation={comments.renderAnnotation}
      renderGutterUtility={comments.renderGutterUtility}
      selectedLines={comments.note.selected}
      commentedLines={comments.commentedLines}
    />
  )

  return (
    <>
      {!props.bare && (
        <div data-slot="session-review-v2-file-header">
          <div data-slot="session-review-v2-file-title">
            <div data-slot="session-review-v2-file-status" data-type={statusType(view.status)}>
              {statusLabel(view.status)}
            </div>
            <FileIcon path={props.file} />
            <span data-slot="session-review-v2-file-name">{getFilename(props.file)}</span>
            {props.file.includes("/") && <span data-slot="session-review-v2-file-path">{getDirectory(props.file)}</span>}
          </div>
          <div data-slot="session-review-v2-file-diff">
            <DiffChanges changes={view} />
          </div>
        </div>
      )}
      <div ref={scroll} data-slot="session-review-v2-diff-scroll">
        {media ? (
          <FileMedia
            path={props.file}
            deleted={view.status === "deleted"}
            readFile={view.status === "deleted" ? undefined : props.readFile}
            fallback={viewer}
          />
        ) : canRender ? (
          viewer
        ) : (
          <div data-slot="session-review-v2-empty">
            <span className="ui-note">{i18n.t("ui.fileMedia.binary.title")}</span>
          </div>
        )}
        {comments.portals}
      </div>
    </>
  )
}
