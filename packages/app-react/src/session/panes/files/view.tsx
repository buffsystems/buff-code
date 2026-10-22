// One opened file (#584): the Solid SessionFileView — its text with line selection and line
// comments, images and audio as media, PDF and video embedded, loading / not found / failed notes,
// Buff's "Add selection to chat" — and the scroll position kept per tab while the window lives.

import { previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import { mimeOf, previewKind } from "@opencode/app/react-reuse/file-content"
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, ScrollArea } from "@buff/ui/react"
import type { SelectedLineRange } from "@pierre/diffs"
import { Ellipsis, Plus } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { promptContext, selectionFromLines, type LineComment } from "../../../core/prompt-context"
import { useI18n } from "../../../i18n/provider"
import { useStore } from "../../../react/use-store"
import { showToast } from "../../../shell/notifications/toast"
import { useLineComments, type CommentMeta } from "../review/comment-controller"
import { FileMedia } from "../viewer/media"
import { contentKey, TextViewer } from "../viewer/viewer"
import type { Files } from "./model"

const NO_COMMENTS: LineComment[] = []
const scrolls = new Map<string, { x: number; y: number }>()
const selectionSide = (range: SelectedLineRange) => range.endSide ?? range.side ?? "additions"

export function FileView(props: { files: Files; tab: string; sessionKey: string }) {
  const i18n = useI18n()
  const path = props.files.pathFromTab(props.tab)
  const state = useStore(props.files.store, (value) => (path ? value.file[path] : undefined))
  const contents = state?.content?.content ?? ""
  const key = props.sessionKey
  const all = useStore(promptContext.store, (value) => value[key]?.comments ?? NO_COMMENTS)
  const comments = useMemo(() => all.filter((comment) => comment.file === path), [all, path])
  const preview = (range: SelectedLineRange) =>
    previewSelectedLines(contents, { start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) })

  const ui = useLineComments({
    file: path ?? props.tab,
    comments,
    enabled: true,
    side: selectionSide,
    onSubmit: (comment, selection) => {
      if (!path) return
      const saved = promptContext.comments.add(key, { file: path, selection, comment })
      promptContext.context.add(key, {
        type: "file",
        path,
        selection: selectionFromLines(selection),
        comment,
        commentID: saved.id,
        commentOrigin: "file",
        preview: preview(selection),
      })
    },
    onUpdate: (id, comment, selection) => {
      if (!path) return
      promptContext.comments.update(key, path, id, comment)
      promptContext.context.updateComment(key, path, id, { comment, preview: preview(selection) })
    },
    onDelete: (comment) => {
      if (!path) return
      promptContext.comments.remove(key, path, comment.id)
      promptContext.context.removeComment(key, path, comment.id)
    },
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
    mention: { items: props.files.searchFilesAndDirectories },
  })

  const viewport = useRef<HTMLDivElement>(null)
  const scrollKey = `${key}\n${props.tab}`
  const restore = () => {
    const position = scrolls.get(scrollKey)
    const element = viewport.current
    if (!position || !element) return
    element.scrollTop = position.y
    element.scrollLeft = position.x
  }
  useLayoutEffect(restore, [scrollKey, state?.loaded])

  const selected = ui.note.selected
  const viewer = (
    <div className="relative overflow-hidden pb-40">
      <TextViewer<CommentMeta>
        file={{ name: path ?? "", contents, cacheKey: contentKey(contents) }}
        enableLineSelection
        enableGutterUtility
        selectedLines={selected}
        commentedLines={ui.commentedLines}
        onRendered={restore}
        annotations={ui.annotations}
        renderAnnotation={ui.renderAnnotation}
        renderGutterUtility={ui.renderGutterUtility}
        onLineSelected={ui.onLineSelected}
        onLineSelectionEnd={ui.onLineSelectionEnd}
        onLineNumberSelectionEnd={ui.onLineNumberSelectionEnd}
        className="select-text"
      />
      {ui.portals}
    </div>
  )

  const body = (() => {
    if (state?.loaded && path)
      return (
        <FilePreview files={props.files} path={path} source={contents}>
          <FileMedia path={path} current={state.content} fallback={viewer} onLoad={restore} />
        </FilePreview>
      )
    if (state?.loading) return <div className="ui-note px-6 py-4">{i18n.t("common.loading")}…</div>
    if (state?.notFound) return <div className="ui-note px-6 py-4">{i18n.t("file.error.notFound", { name: state.name })}</div>
    if (state?.error) return <div className="ui-note px-6 py-4">{state.error}</div>
    return null
  })()

  return (
    <div data-component="session-file-view" className="relative mt-3 h-full min-h-0">
      {path && selected && (
        <div className="buff-selection-to-chat" data-component="buff-selection-to-chat">
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={Plus}
            data-action="buff-selection-to-chat"
            onClick={() => {
              promptContext.context.add(key, { type: "file", path, selection: selectionFromLines(selected) })
              showToast({ title: i18n.buff.t("Added to chat"), description: path })
            }}
          >
            {i18n.buff.t("Add selection to chat")}
          </Button>
        </div>
      )}
      <ScrollArea
        orientation="both"
        type="scroll"
        className="h-full"
        viewportProps={{
          ref: viewport,
          className: "scroll-view__viewport",
          onScroll: (event) =>
            scrolls.set(scrollKey, { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop }),
        }}
      >
        {body}
      </ScrollArea>
    </div>
  )
}

/**
 * Buff (#451): Markdown and Mermaid get a Preview / Source switch, PDF and video an embedded
 * player read when shown; everything else is the file itself.
 */
function FilePreview(props: { files: Files; path: string; source: string; children: ReactNode }) {
  const i18n = useI18n()
  const kind = previewKind(props.path)
  const [source, setSource] = useState(false)
  if (kind === "pdf" || kind === "video") return <Embedded files={props.files} path={props.path} kind={kind} />
  if (kind !== "markdown" && kind !== "mermaid") return props.children
  return (
    <div className="buff-preview" data-component="buff-preview">
      <div className="buff-preview-switch" role="tablist">
        <button type="button" role="tab" aria-selected={!source} data-active={!source} data-action="buff-preview-view" onClick={() => setSource(false)}>
          {i18n.buff.t("Preview")}
        </button>
        <button type="button" role="tab" aria-selected={source} data-active={source} data-action="buff-preview-source" onClick={() => setSource(true)}>
          {i18n.buff.t("Source")}
        </button>
      </div>
      {source ? (
        props.children
      ) : (
        <div className="buff-preview-markdown ui-prose" data-component="buff-preview-markdown">
          <pre className="whitespace-pre-wrap">{props.source}</pre>
        </div>
      )}
    </div>
  )
}

function Embedded(props: { files: Files; path: string; kind: "pdf" | "video" }) {
  const i18n = useI18n()
  const [url, setUrl] = useState<{ src?: string; error?: boolean }>({})
  useEffect(() => {
    const active = { value: true, src: undefined as string | undefined }
    void props.files.readBytes(props.path).then(
      (bytes) => {
        if (!active.value) return
        active.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeOf(props.path) ?? "application/octet-stream" }))
        setUrl({ src: active.src })
      },
      () => active.value && setUrl({ error: true }),
    )
    return () => {
      active.value = false
      if (active.src) URL.revokeObjectURL(active.src)
    }
  }, [props.files, props.path])
  if (!url.src)
    return (
      <div className="ui-note px-6 py-4">
        {url.error ? i18n.buff.t("Could not open the file.") : i18n.buff.t("Loading…")}
      </div>
    )
  if (props.kind === "video") return <video src={url.src} controls className="buff-media-view" title={props.path} />
  return <iframe src={url.src} className="buff-media-view h-full w-full" title={props.path} />
}
