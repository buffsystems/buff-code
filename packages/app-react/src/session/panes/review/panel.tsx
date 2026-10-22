// The review panel (#584): the changed files beside the selected file's diff — the Solid
// SessionReviewV2, its sidebar (filter, tree or result list, resize) and ReviewPanelView. The arrow
// keys step through the files while the panel is shown, never while typing.

import { normalizeFileTreeV2Path, sortFileTreeV2Paths } from "@opencode/app/react-reuse/file-tree-model"
import {
  filterRenderableDiff,
  filterReviewFiles,
  reviewDiffKinds,
  reviewDiffNeedsLoad,
} from "@opencode/app/react-reuse/review-diff-kinds"
import type { FileDiffInfo } from "@opencode/client/promise"
import { IconButton, ResizeHandle, Tooltip } from "@buff/ui/react"
import { ArrowLeft, ArrowRight, Columns2, FoldVertical, PanelLeft, Rows2, Search, UnfoldVertical, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react"
import { useI18n } from "../../../i18n/provider"
import { useStore } from "../../../react/use-store"
import { DiffChanges } from "../diff-changes"
import type { Files } from "../files/model"
import { applyFileListKeyDown, FileList, FileTree, type Kind } from "../files/tree"
import {
  REVIEW_SIDEBAR_WIDTH_DEFAULT,
  REVIEW_SIDEBAR_WIDTH_MAX,
  REVIEW_SIDEBAR_WIDTH_MIN,
  type DiffStyle,
  type ExpandMode,
  type PanesLayout,
} from "../layout"
import { PaneScrollView } from "../scroll-view"
import type { ReadFile } from "../viewer/media"
import { ReviewFilePreview, type ReviewCommentHandlers } from "./file-preview"
import type { Mention } from "./line-comment"

export function ReviewSidebarToggle(props: { layout: PanesLayout; disabled?: boolean }) {
  const i18n = useI18n()
  const opened = useStore(props.layout.panel, (panel) => panel.sidebarOpened)
  const label = i18n.t("ui.sessionReviewV2.toggleSidebar")
  return (
    <Tooltip content={label}>
      <IconButton
        icon={PanelLeft}
        size="sm"
        className="session-review-v2-sidebar-toggle"
        aria-label={label}
        aria-expanded={opened}
        data-expanded={opened ? "" : undefined}
        disabled={props.disabled}
        onClick={props.layout.toggleSidebar}
      />
    </Tooltip>
  )
}

/** The sidebar of the review and of the file browser: filter on top, a scrolling list below. */
export function ReviewSidebar(props: {
  open: boolean
  title?: ReactNode
  stats?: ReactNode
  filter: string
  onFilterChange: (value: string) => void
  onFilterKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  filterRef?: Ref<HTMLInputElement>
  filterControls?: string
  filterActiveDescendant?: string
  filterExpanded?: boolean
  width: number
  onWidthChange?: (width: number) => void
  children?: ReactNode
}) {
  const i18n = useI18n()
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    if (!resizing) return
    const stop = () => setResizing(false)
    document.addEventListener("pointerup", stop)
    document.addEventListener("pointercancel", stop)
    return () => {
      document.removeEventListener("pointerup", stop)
      document.removeEventListener("pointercancel", stop)
    }
  }, [resizing])
  const label = i18n.t("ui.sessionReviewV2.filterFiles")
  return (
    <div data-component="session-review-v2-sidebar-root">
      {props.open && (
        <aside data-slot="session-review-v2-sidebar" data-resizing={resizing ? "" : undefined} style={{ width: props.width }}>
          <div data-slot="session-review-v2-sidebar-header">
            <div data-slot="session-review-v2-sidebar-title">{props.title}</div>
            {props.stats}
          </div>
          <div data-slot="session-review-v2-sidebar-filter">
            <label className="panes-filter">
              <Search aria-hidden className="size-3.5 shrink-0" />
              <input
                ref={props.filterRef}
                type="search"
                className="panes-filter__input"
                value={props.filter}
                onChange={(event) => props.onFilterChange(event.currentTarget.value)}
                onKeyDown={props.onFilterKeyDown}
                placeholder={label}
                aria-label={label}
                role={props.filterControls ? "combobox" : undefined}
                aria-autocomplete={props.filterControls ? "list" : undefined}
                aria-controls={props.filterControls}
                aria-activedescendant={props.filterActiveDescendant}
                aria-expanded={props.filterControls ? props.filterExpanded : undefined}
              />
              {props.filter.length > 0 && (
                <IconButton
                  icon={X}
                  size="xs"
                  aria-label={i18n.t("ui.list.clearFilter")}
                  onClick={() => props.onFilterChange("")}
                />
              )}
            </label>
          </div>
          <PaneScrollView data-slot="session-review-v2-sidebar-tree" className="min-h-0 flex-1">
            {props.children}
          </PaneScrollView>
        </aside>
      )}
      {props.open && props.onWidthChange && (
        <div data-slot="session-review-v2-sidebar-resize" onPointerDown={() => setResizing(true)}>
          <ResizeHandle
            direction="horizontal"
            size={props.width}
            min={REVIEW_SIDEBAR_WIDTH_MIN}
            max={REVIEW_SIDEBAR_WIDTH_MAX}
            onResize={props.onWidthChange}
            onDoubleClick={() => props.onWidthChange?.(REVIEW_SIDEBAR_WIDTH_DEFAULT)}
            aria-label={i18n.buff.t("Resize the file list")}
            className="absolute inset-y-0 -end-1.5"
          />
        </div>
      )}
    </div>
  )
}

/** The review's frame: the sidebar, the toolbar and the preview of the selected file. */
export function FilePanel(props: {
  sidebar?: ReactNode
  toolbar: boolean
  toolbarStart?: ReactNode
  toolbarEnd?: ReactNode
  children?: ReactNode
}) {
  return (
    <div data-component="session-review-v2">
      <div data-slot="session-review-v2-body">
        {props.sidebar}
        <div data-slot="session-review-v2-preview">
          {props.toolbar && (
            <div data-slot="session-review-v2-toolbar">
              <div data-slot="session-review-v2-toolbar-group" className="session-review-v2-toolbar-group--start">
                {props.toolbarStart}
              </div>
              {props.toolbarEnd && (
                <div data-slot="session-review-v2-toolbar-group" className="session-review-v2-toolbar-group--segments">
                  {props.toolbarEnd}
                </div>
              )}
            </div>
          )}
          {props.children}
        </div>
      </div>
    </div>
  )
}

function Toggle(props: { label: string; pressed: boolean; icon: typeof ArrowLeft; onClick: () => void }) {
  return (
    <Tooltip content={props.label}>
      <IconButton
        icon={props.icon}
        size="xs"
        aria-label={props.label}
        aria-pressed={props.pressed}
        data-pressed={props.pressed ? "" : undefined}
        onClick={props.onClick}
      />
    </Tooltip>
  )
}

export function ReviewPanel(props: {
  layout: PanesLayout
  files?: Files
  title?: ReactNode
  empty?: ReactNode
  diffs: FileDiffInfo[]
  diffsReady: boolean
  diffVersion?: number
  loadDiff?: (path: string, version?: number) => Promise<FileDiffInfo | undefined>
  activeFile?: string
  onSelectFile: (path: string) => void
  diffStyle: DiffStyle
  onDiffStyleChange?: (style: DiffStyle) => void
  readFile?: ReadFile
  comments?: ReviewCommentHandlers
  mention?: Mention
}) {
  const i18n = useI18n()
  const panel = useStore(props.layout.panel, (value) => value)
  const filter = useStore(props.layout.filter, (value) => value)
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl"
  const diffs = useMemo(() => props.diffs.filter(filterRenderableDiff), [props.diffs])
  const filtered = useMemo(() => filterReviewFiles(diffs.map((diff) => diff.file), filter), [diffs, filter])
  const searching = filter.trim().length > 0
  const files = useMemo(() => (searching ? filtered : sortFileTreeV2Paths(filtered)), [searching, filtered])
  const kinds = useMemo(() => reviewDiffKinds(diffs), [diffs])
  // A changes-only tree omits "M": every row is a change; A and D stay visible.
  const treeKinds = useMemo(() => new Map([...kinds].filter(([, kind]) => kind !== "mix")) as Map<string, Kind>, [kinds])
  const focus = props.comments?.focus
  const active = (() => {
    if (focus && diffs.some((diff) => diff.file === focus.file)) return focus.file
    if (searching) return props.activeFile
    if (props.activeFile && files.includes(props.activeFile)) return props.activeFile
    return files[0]
  })()
  const source = diffs.find((diff) => diff.file === active)
  const loaded = useLoadedDiff(source, props.loadDiff, props.diffVersion)
  const index = active ? Math.max(0, files.indexOf(active)) : -1
  const step = (offset: 1 | -1) => (files.length > 0 ? files[(index + offset + files.length) % files.length] : undefined)
  const previous = step(-1)
  const next = step(1)
  const latest = useRef({ previous, next, has: diffs.length > 0, select: props.onSelectFile, rtl })
  latest.current = { previous, next, has: diffs.length > 0, select: props.onSelectFile, rtl }

  // The advertised arrow keys work while the pane is mounted, never while typing.
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      const back = latest.current.rtl ? "ArrowRight" : "ArrowLeft"
      const forward = latest.current.rtl ? "ArrowLeft" : "ArrowRight"
      if (event.key !== back && event.key !== forward) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) return
      if (!latest.current.has) return
      const file = event.key === back ? latest.current.previous : latest.current.next
      if (!file) return
      event.preventDefault()
      latest.current.select(file)
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [])

  const [highlight, setHighlight] = useState<string>()
  const highlighted = searching && filtered.length > 0 ? (highlight && filtered.includes(highlight) ? highlight : filtered[0]) : undefined

  const sidebar = (
    <ReviewSidebar
      open={panel.sidebarOpened}
      title={props.title}
      stats={<DiffChanges changes={diffs} />}
      filter={filter}
      onFilterChange={props.layout.setFilter}
      onFilterKeyDown={(event) => {
        if (!searching) return
        applyFileListKeyDown(event, filtered, highlighted, { onHighlight: setHighlight, onSelect: props.onSelectFile })
      }}
      width={panel.sidebarWidth}
      onWidthChange={props.layout.resizeSidebar}
    >
      {!props.diffsReady ? (
        <div className="ui-note px-2 py-2">
          {i18n.t("common.loading")}
          {i18n.t("common.loading.ellipsis")}
        </div>
      ) : searching ? (
        filtered.length > 0 ? (
          <FileList
            files={filtered}
            kinds={treeKinds}
            active={active}
            highlighted={highlighted}
            onFileClick={(path) => {
              setHighlight(path)
              props.onSelectFile(path)
            }}
          />
        ) : (
          <div className="ui-note px-2 py-2">{i18n.t("palette.empty")}</div>
        )
      ) : props.files ? (
        <FileTree
          files={props.files}
          allowed={filtered}
          kinds={treeKinds}
          draggable={false}
          active={active}
          onFileClick={(node) => props.onSelectFile(node.path)}
        />
      ) : null}
    </ReviewSidebar>
  )

  const toolbarStart = (
    <>
      {!panel.sidebarOpened && (
        <div data-slot="session-review-v2-toolbar-collapsed-meta">
          {props.title && <div data-slot="session-review-v2-toolbar-title">{props.title}</div>}
          <DiffChanges changes={diffs} />
          {files.length > 0 && (
            <span data-slot="session-review-v2-file-position">
              {index + 1}/{files.length}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center">
        <Tooltip content={i18n.t("ui.sessionReviewV2.previousFile")}>
          <IconButton
            icon={rtl ? ArrowRight : ArrowLeft}
            size="xs"
            className="session-review-v2-file-nav-button"
            disabled={!previous}
            onClick={() => previous && props.onSelectFile(previous)}
            aria-label={i18n.t("ui.sessionReviewV2.previousFile")}
          />
        </Tooltip>
        <Tooltip content={i18n.t("ui.sessionReviewV2.nextFile")}>
          <IconButton
            icon={rtl ? ArrowLeft : ArrowRight}
            size="xs"
            className="session-review-v2-file-nav-button"
            disabled={!next}
            onClick={() => next && props.onSelectFile(next)}
            aria-label={i18n.t("ui.sessionReviewV2.nextFile")}
          />
        </Tooltip>
      </div>
    </>
  )

  const expand = (mode: ExpandMode) => props.layout.setExpandMode(mode)
  const toolbarEnd = (
    <>
      <div role="group" aria-label={i18n.t("ui.sessionReviewV2.expandMode")} className="session-review-v2-segmented-control">
        <Toggle
          label={i18n.t("ui.sessionReviewV2.showAllLines")}
          pressed={panel.expandMode === "expand"}
          icon={UnfoldVertical}
          onClick={() => expand("expand")}
        />
        <Toggle
          label={i18n.t("ui.sessionReviewV2.hideNonDiffLines")}
          pressed={panel.expandMode === "collapse"}
          icon={FoldVertical}
          onClick={() => expand("collapse")}
        />
      </div>
      {props.onDiffStyleChange && (
        <div role="group" aria-label={i18n.t("ui.sessionReviewV2.diffView")} className="session-review-v2-segmented-control">
          <Toggle
            label={i18n.t("ui.sessionReviewV2.unifiedDiff")}
            pressed={props.diffStyle === "unified"}
            icon={Rows2}
            onClick={() => props.onDiffStyleChange?.("unified")}
          />
          <Toggle
            label={i18n.t("ui.sessionReviewV2.splitDiff")}
            pressed={props.diffStyle === "split"}
            icon={Columns2}
            onClick={() => props.onDiffStyleChange?.("split")}
          />
        </div>
      )}
    </>
  )

  const diff = loaded ?? source
  return (
    <FilePanel sidebar={sidebar} toolbar={diffs.length > 0} toolbarStart={toolbarStart} toolbarEnd={toolbarEnd}>
      {diffs.length === 0 ? (
        props.empty
      ) : active && diff ? (
        <ReviewFilePreview
          key={active}
          file={active}
          diff={diff}
          diffStyle={props.diffStyle}
          expandMode={panel.expandMode}
          readFile={props.readFile}
          comments={props.comments}
          mention={props.mention}
        />
      ) : (
        <div data-slot="session-review-v2-empty">{props.empty}</div>
      )}
    </FilePanel>
  )
}

/** A diff without hunks is read again in full for the preview; refreshed data replaces it. */
function useLoadedDiff(
  source: FileDiffInfo | undefined,
  load: ((path: string, version?: number) => Promise<FileDiffInfo | undefined>) | undefined,
  version: number | undefined,
) {
  const [loaded, setLoaded] = useState<{ source: FileDiffInfo; version?: number; value: FileDiffInfo }>()
  const needed = !!source && !!load && reviewDiffNeedsLoad(source)
  useEffect(() => {
    if (!needed || !source || !load) return
    const active = { value: true }
    void load(source.file, version).then((value) => {
      if (!active.value || value?.file !== source.file) return
      setLoaded({ source, version, value })
    })
    return () => {
      active.value = false
    }
  }, [needed, source, load, version])
  if (!loaded || loaded.source !== source || loaded.version !== version) return
  return loaded.value
}

export const normalizeReviewPath = normalizeFileTreeV2Path
