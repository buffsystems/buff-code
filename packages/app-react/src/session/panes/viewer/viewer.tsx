// A file or a diff in Pierre's viewer (#584): the Solid File component as a React component that
// drives Pierre imperatively — virtualized for large inputs, with line selection, commented-line
// marks and annotations (line comments) whose React content is portalled into Pierre's hosts.

import {
  areOptionsEqual,
  DEFAULT_VIRTUAL_FILE_METRICS,
  File as PierreFile,
  FileDiff,
  VirtualizedFile,
  VirtualizedFileDiff,
  Virtualizer,
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffMetadata,
  type FileDiffOptions,
  type FileOptions,
  type LineAnnotation,
  type SelectedLineRange,
} from "@pierre/diffs"
import { createDefaultOptions, styleVariables } from "@opencode/session-ui/pierre"
import { markCommentedDiffLines, markCommentedFileLines } from "@opencode/session-ui/pierre/commented-lines"
import { fixDiffSelection } from "@opencode/session-ui/pierre/diff-selection"
import {
  applyViewerScheme,
  clearReadyWatcher,
  createReadyWatcher,
  getViewerHost,
  getViewerRoot,
  notifyShadowReady,
  observeViewerScheme,
} from "@opencode/session-ui/pierre/file-runtime"
import { findCodeSelectionSide, findDiffLineNumber, findFileLineNumber } from "@opencode/session-ui/pierre/file-selection"
import { restoreShadowTextSelection } from "@opencode/session-ui/pierre/selection-bridge"
import { acquireVirtualizer, virtualMetrics } from "@opencode/session-ui/pierre/virtualizer"
import { getWorkerPool } from "@opencode/session-ui/pierre/worker"
import { sampledChecksum } from "@opencode/util/encode"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react"
import {
  createLineSelection,
  diffMouseSide,
  diffSelectionSide,
  mouseHit,
  parseLine,
  type LineSelection,
  type SelectionMode,
} from "./selection"

const VIRTUALIZE_BYTES = 500_000
const LARGE_DIFF = 500_000
const codeMetrics = { ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight: 24, spacing: 0 }
const largeOptions = { lineDiffType: "none", maxLineDiffLength: 0, tokenizeMaxLineLength: 1 } as const

export type HoveredLine = { lineNumber: number; side?: "additions" | "deletions" }

type Shared<Meta> = {
  enableLineSelection?: boolean
  enableGutterUtility?: boolean
  selectedLines?: SelectedLineRange | null
  commentedLines?: SelectedLineRange[]
  /** Pierre asks for each annotation's host element; the caller portals its content into it. */
  renderAnnotation?: (annotation: DiffLineAnnotation<Meta> | LineAnnotation<Meta>) => HTMLElement | undefined
  renderGutterUtility?: (hovered: () => HoveredLine | undefined) => HTMLElement | undefined
  onLineSelected?: (range: SelectedLineRange | null) => void
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void
  onLineNumberSelectionEnd?: (range: SelectedLineRange | null) => void
  onRendered?: () => void
  overflow?: "wrap" | "scroll"
  className?: string
}

export type DiffViewerProps<Meta> = Shared<Meta> & {
  fileDiff: FileDiffMetadata
  annotations?: DiffLineAnnotation<Meta>[]
  diffStyle: "unified" | "split"
  expandUnchanged?: boolean
  virtualize?: boolean
  hunkSeparators?: FileDiffOptions<Meta>["hunkSeparators"]
}

export type TextViewerProps<Meta> = Shared<Meta> & {
  file: FileContents
  /** A diff annotation's side is ignored in a file. */
  annotations?: (LineAnnotation<Meta> | DiffLineAnnotation<Meta>)[]
}

type Instance<Meta> = {
  cleanUp(): void
  setSelectedLines(range: SelectedLineRange | null): void
  setLineAnnotations(annotations: never[]): void
  rerender(): void
}

/** The machinery both viewers share: the container, the ready watcher, selection and marks. */
function useViewerShell<Meta>(props: Shared<Meta>, mode: (selection: () => LineSelection) => SelectionMode) {
  const container = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const ready = useRef(createReadyWatcher())
  const [rendered, setRendered] = useState(0)
  const root = () => getViewerRoot(container.current ?? undefined)
  const selection = useMemo(() => {
    const holder: { current?: LineSelection } = {}
    holder.current = createLineSelection({
      root,
      enabled: () => latest.current.enableLineSelection === true,
      mode: mode(() => holder.current!),
      onSelectionEnd: (range) => latest.current.onLineSelectionEnd?.(range),
    })
    // The controller reads the latest props through refs; it lives as long as the viewer.
    return holder.current
  }, [])

  useEffect(() => {
    const element = container.current
    if (!element) return
    const stopScheme = observeViewerScheme(() => getViewerHost(element))
    const detach = selection.attach(element)
    return () => {
      stopScheme()
      detach()
      clearReadyWatcher(ready.current)
    }
  }, [selection])

  // Pierre's own callbacks keep the controller's last range and pass the event on.
  const lineCallbacks = useMemo(
    () => ({
      onLineSelected: (range: SelectedLineRange | null) => {
        selection.last = range
        latest.current.onLineSelected?.(range)
      },
      onLineSelectionEnd: (range: SelectedLineRange | null) => {
        selection.last = range
        latest.current.onLineSelectionEnd?.(range)
        if (!selection.bridge.consume(range)) return
        requestAnimationFrame(() => latest.current.onLineNumberSelectionEnd?.(range))
      },
      renderAnnotation: (annotation: DiffLineAnnotation<Meta> | LineAnnotation<Meta>) =>
        latest.current.renderAnnotation?.(annotation),
      renderGutterUtility: (hovered: () => HoveredLine | undefined) => latest.current.renderGutterUtility?.(hovered),
    }),
    [selection],
  )

  return { container, latest, ready, rendered, setRendered, root, selection, lineCallbacks }
}

function useCommentedMarks(
  root: () => ShadowRoot | undefined,
  rendered: number,
  ranges: SelectedLineRange[] | undefined,
  mark: (root: ShadowRoot, ranges: SelectedLineRange[]) => void,
) {
  useEffect(() => {
    const shadow = root()
    if (!shadow) return
    const list = ranges ?? []
    if (list.length === 0) return void mark(shadow, list)
    const frame: { id?: number } = {}
    const schedule = () => {
      if (frame.id !== undefined) cancelAnimationFrame(frame.id)
      frame.id = requestAnimationFrame(() => {
        frame.id = undefined
        mark(shadow, list)
      })
    }
    const observer = new MutationObserver(schedule)
    observer.observe(shadow, { childList: true, subtree: true })
    schedule()
    return () => {
      observer.disconnect()
      if (frame.id !== undefined) cancelAnimationFrame(frame.id)
    }
  }, [rendered, ranges])
}

function useAnnotations<Meta>(
  instance: { current?: Instance<Meta> },
  rendered: number,
  annotations: (DiffLineAnnotation<Meta> | LineAnnotation<Meta>)[] | undefined,
) {
  const applied = useRef(new WeakSet<Instance<Meta>>())
  useEffect(() => {
    const active = instance.current
    if (!active) return
    const list = annotations ?? []
    // A fresh render draws without annotations; skip the extra rerender when there is nothing to show.
    if (list.length === 0 && !applied.current.has(active)) return
    if (list.length === 0) applied.current.delete(active)
    else applied.current.add(active)
    active.setLineAnnotations(list as never[])
    active.rerender()
  }, [instance, rendered, annotations])
}

function scrollParent(element: HTMLElement): HTMLElement | undefined {
  const parent = element.parentElement
  if (!parent) return
  const style = getComputedStyle(parent)
  if (style.overflowY === "auto" || style.overflowY === "scroll") return parent
  return scrollParent(parent)
}

const style = styleVariables as CSSProperties

/** A diff of one file. */
export function DiffViewer<Meta>(props: DiffViewerProps<Meta>) {
  const instance = useRef<{ current?: FileDiff<Meta> & Instance<Meta>; virtualizer?: Virtualizer; pool?: unknown; separators?: unknown; target?: FileDiffMetadata }>({})
  const shared = useRef<ReturnType<typeof acquireVirtualizer>>(undefined)
  const shell = useViewerShell<Meta>(
    props,
    (selection) => ({
      sided: true,
      lineFromEvent: (event) => mouseHit(event, findDiffLineNumber, diffMouseSide),
      lineForNode: findDiffLineNumber,
      sideForNode: diffSelectionSide,
      apply: (range, preserve) => applyDiff(range, preserve, selection()),
    }),
  )
  const applyDiff = (
    range: SelectedLineRange | null,
    preserve: { root: ShadowRoot; text: Range } | undefined,
    selection: LineSelection,
  ) => {
    const active = instance.current.current
    if (!active) return
    const fixed = fixDiffSelection(shell.root(), range)
    if (fixed === undefined) {
      selection.last = range
      return
    }
    selection.last = fixed
    active.setSelectedLines(fixed)
    restoreShadowTextSelection(preserve?.root, preserve?.text)
  }

  const large = Math.max(props.fileDiff.deletionLines.join("").length, props.fileDiff.additionLines.join("").length) > LARGE_DIFF
  const options = useMemo<FileDiffOptions<Meta>>(() => {
    const base = {
      ...createDefaultOptions<Meta>(props.diffStyle),
      ...(props.overflow ? { overflow: props.overflow } : {}),
      ...(props.hunkSeparators ? { hunkSeparators: props.hunkSeparators } : {}),
      expandUnchanged: props.expandUnchanged,
      enableLineSelection: props.enableLineSelection,
      enableGutterUtility: props.enableGutterUtility,
      ...shell.lineCallbacks,
      onLineSelected: (range: SelectedLineRange | null) =>
        shell.lineCallbacks.onLineSelected(fixDiffSelection(shell.root(), range) ?? range),
      onLineSelectionEnd: (range: SelectedLineRange | null) =>
        shell.lineCallbacks.onLineSelectionEnd(fixDiffSelection(shell.root(), range) ?? range),
    } as FileDiffOptions<Meta>
    return large ? { ...base, ...largeOptions } : base
  }, [props.diffStyle, props.overflow, props.hunkSeparators, props.expandUnchanged, props.enableLineSelection, props.enableGutterUtility, large])

  useLayoutEffect(() => {
    const element = shell.container.current
    if (!element) return
    const pool = getWorkerPool(large ? "none" : "word-alt")
    if (props.virtualize === false) {
      shared.current?.release()
      shared.current = undefined
    }
    if (props.virtualize !== false && !shared.current) shared.current = acquireVirtualizer(element)
    const virtualizer = shared.current?.virtualizer
    const state = instance.current
    const targetChanged = state.target !== props.fileDiff
    // Virtualized instances keep their first target and separator metrics; reset when that is unsafe.
    const reset =
      state.current !== undefined &&
      (state.virtualizer !== virtualizer ||
        state.pool !== pool ||
        (virtualizer !== undefined && (state.separators !== options.hunkSeparators || targetChanged)))
    const forceRender = !reset && state.current !== undefined && !areOptionsEqual(state.current.options, options)
    clearReadyWatcher(shell.ready.current)
    if (reset) state.current?.cleanUp()
    if (reset || !state.current) {
      element.innerHTML = ""
      state.current = (
        virtualizer
          ? new VirtualizedFileDiff<Meta>(options, virtualizer, virtualMetrics, pool)
          : new FileDiff<Meta>(options, pool)
      ) as FileDiff<Meta> & Instance<Meta>
      state.virtualizer = virtualizer
      state.pool = pool
      state.separators = virtualizer ? options.hunkSeparators : undefined
    }
    if (!reset && state.current) state.current.setOptions(options)
    state.target = props.fileDiff
    state.current.render({ fileDiff: props.fileDiff, forceRender, lineAnnotations: [], containerWrapper: element })
    applyViewerScheme(getViewerHost(element))
    shell.setRendered((value) => value + 1)
    notifyShadowReady({
      state: shell.ready.current,
      container: element,
      getRoot: shell.root,
      isReady: (root) => root.querySelector("[data-line]") != null,
      settleFrames: 1,
      onReady: () => {
        applyDiff(shell.selection.last, undefined, shell.selection)
        shell.latest.current.onRendered?.()
      },
    })
  }, [options, props.fileDiff, props.virtualize, large])

  useLayoutEffect(
    () => () => {
      instance.current.current?.cleanUp()
      instance.current = {}
      shared.current?.release()
      shared.current = undefined
    },
    [],
  )

  useEffect(() => applyDiff(props.selectedLines ?? null, undefined, shell.selection), [props.selectedLines])
  useCommentedMarks(shell.root, shell.rendered, props.commentedLines, markCommentedDiffLines)
  useAnnotations(useMemo(() => ({ get current() { return instance.current.current } }), []), shell.rendered, props.annotations)

  return <ViewerFrame mode="diff" container={shell.container} className={props.className} />
}

/** One file's text. */
export function TextViewer<Meta>(props: TextViewerProps<Meta>) {
  const instance = useRef<{ current?: PierreFile<Meta> & Instance<Meta>; virtual?: Virtualizer }>({})
  const contents = typeof props.file.contents === "string" ? props.file.contents : String(props.file.contents ?? "")
  const lines = Math.max(1, contents.split("\n").length - (contents.endsWith("\n") ? 1 : 0))
  const virtual = contents.length > VIRTUALIZE_BYTES
  const shell = useViewerShell<Meta>(
    props,
    (selection) => ({
      sided: false,
      lineFromEvent: (event) => mouseHit(event, parseLine),
      lineForNode: findFileLineNumber,
      sideForNode: findCodeSelectionSide,
      apply: (range) => {
        selection().last = range
        applyText(range)
      },
    }),
  )
  const applyText = (range: SelectedLineRange | null) => {
    const active = instance.current.current
    if (!active) return
    if (virtual) return active.setSelectedLines(range)
    const root = shell.root()
    if (!root || root.querySelectorAll("[data-line]").length < lines) return
    if (!range) return active.setSelectedLines(null)
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    if (start < 1 || end > lines) return active.setSelectedLines(null)
    if (!root.querySelector(`[data-line="${start}"]`) || !root.querySelector(`[data-line="${end}"]`))
      return active.setSelectedLines(null)
    const plain =
      range.endSide != null || (range.side === "deletions" && root.querySelector("[data-deletions]") == null)
    active.setSelectedLines(plain ? { start: range.start, end: range.end } : range)
  }

  const options = useMemo<FileOptions<Meta>>(
    () =>
      ({
        ...createDefaultOptions<Meta>("unified"),
        ...(props.overflow ? { overflow: props.overflow } : {}),
        enableLineSelection: props.enableLineSelection,
        enableGutterUtility: props.enableGutterUtility,
        ...shell.lineCallbacks,
      }) as FileOptions<Meta>,
    [props.overflow, props.enableLineSelection, props.enableGutterUtility],
  )

  useLayoutEffect(() => {
    const element = shell.container.current
    if (!element) return
    const state = instance.current
    state.current?.cleanUp()
    state.virtual?.cleanUp()
    state.virtual = undefined
    if (virtual) {
      const parent = scrollParent(element)
      state.virtual = new Virtualizer()
      state.virtual.setup(parent ?? document, parent ? element : undefined)
    }
    const pool = getWorkerPool()
    element.innerHTML = ""
    state.current = (
      state.virtual
        ? new VirtualizedFile<Meta>(options, state.virtual, codeMetrics, pool)
        : new PierreFile<Meta>(options, pool)
    ) as PierreFile<Meta> & Instance<Meta>
    clearReadyWatcher(shell.ready.current)
    state.current.render({ file: { ...props.file, contents }, lineAnnotations: [], containerWrapper: element })
    applyViewerScheme(getViewerHost(element))
    shell.setRendered((value) => value + 1)
    notifyShadowReady({
      state: shell.ready.current,
      container: element,
      getRoot: shell.root,
      isReady: (root) =>
        virtual ? root.querySelector("[data-line]") != null : root.querySelectorAll("[data-line]").length >= lines,
      onReady: () => {
        applyText(shell.selection.last)
        shell.latest.current.onRendered?.()
      },
    })
  }, [options, props.file.name, contents, virtual])

  useLayoutEffect(
    () => () => {
      instance.current.current?.cleanUp()
      instance.current.virtual?.cleanUp()
      instance.current = {}
    },
    [],
  )

  useEffect(() => {
    shell.selection.last = props.selectedLines ?? null
    applyText(props.selectedLines ?? null)
  }, [props.selectedLines])
  useCommentedMarks(shell.root, shell.rendered, props.commentedLines, markCommentedFileLines)
  useAnnotations(useMemo(() => ({ get current() { return instance.current.current } }), []), shell.rendered, props.annotations)

  return <ViewerFrame mode="text" container={shell.container} className={props.className} />
}

function ViewerFrame(props: { mode: "text" | "diff"; container: RefObject<HTMLDivElement | null>; className?: string }) {
  return (
    <div
      data-component="file"
      data-mode={props.mode}
      dir="ltr"
      style={style}
      className={["relative select-text outline-none", props.className].filter(Boolean).join(" ")}
      tabIndex={0}
    >
      <div ref={props.container} />
    </div>
  )
}

/** A stable content key for Pierre's highlighter cache. */
export const contentKey = (contents: string) => sampledChecksum(contents, contents.length)
