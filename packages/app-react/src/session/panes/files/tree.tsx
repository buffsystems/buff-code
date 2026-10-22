// The file trees of the panes (#584): the Solid FileTreeV2 (a workspace's live tree, or a tree
// built from a list of paths such as the changed files) and SessionFileList (flat search results),
// virtualized, with the same row slots and change badges.

import {
  buildFileTreeV2Model,
  flattenFileTreeV2,
  flattenLiveFileTreeV2,
  normalizeFileTreeV2Path,
  type FileTreeV2Node,
  type FileTreeV2Row,
} from "@opencode/app/react-reuse/file-tree-model"
import { getDirectory, getFilename } from "@opencode/util/path"
import { ChevronDown } from "lucide-react"
import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { ContextMenu, type ContextMenuTrigger } from "../../../shell/menu/context-menu"
import { useStore } from "../../../react/use-store"
import { FileIcon } from "../file-icon"
import { useVirtualRows } from "../virtual"
import { childrenOf, type FileNode, type Files } from "./model"

export type Kind = "add" | "del" | "mix"

const INDENT_STEP = 16

export const kindLabel = (kind: Kind) => (kind === "add" ? "A" : kind === "del" ? "D" : "M")
export const kindChange = (kind: Kind) => (kind === "add" ? "added" : kind === "del" ? "deleted" : "modified")

function paddingStart(level: number, type: FileNode["type"]) {
  if (type === "directory") return 8 + level * INDENT_STEP
  if (level === 0) return 8
  return 8 + level * INDENT_STEP - INDENT_STEP
}

const rowStyle = (start: number, size: number): CSSProperties => ({
  position: "absolute",
  top: 0,
  insetInlineStart: 0,
  width: "100%",
  minWidth: "max-content",
  height: size,
  transform: `translateY(${start}px)`,
})

/** Widen the tree to its widest row so long names scroll horizontally instead of clipping. */
function syncWidth(element: HTMLDivElement | null) {
  if (!element) return
  queueMicrotask(() => {
    if (!element.isConnected) return
    const width = Math.max(element.clientWidth, ...Array.from(element.children, (child) => child.scrollWidth))
    if (width > element.clientWidth) element.style.width = `${width}px`
  })
}

/** A file row's context menu (desktop: «Open in», copy the path, add to chat); none on the web. */
export const FileRowMenu = createContext<((path: string) => ReactNode) | undefined>(undefined)

/** A file's row with the context menu, when the panel provides one; folders have none. */
function WithRowMenu(props: { path: string | undefined; children: (trigger?: ContextMenuTrigger) => ReactNode }) {
  const menu = use(FileRowMenu)
  if (!menu || props.path === undefined) return props.children()
  return <ContextMenu content={menu(props.path)}>{(trigger) => props.children(trigger)}</ContextMenu>
}

export function FileTree(props: {
  files: Files
  /** Only these paths, as a tree (the changed files); every path of the workspace when absent. */
  allowed?: readonly string[]
  kinds?: ReadonlyMap<string, Kind>
  active?: string
  draggable?: boolean
  onFileClick?: (node: FileNode) => void
  onFileDoubleClick?: (node: FileNode) => void
}) {
  const live = props.allowed === undefined
  const state = useStore(props.files.store, (value) => value)
  const model = useMemo(() => (live ? undefined : buildFileTreeV2Model(props.allowed ?? [])), [live, props.allowed])
  const expanded = (path: string) => state.dir[path]?.expanded ?? !live
  const rows = useMemo<FileTreeV2Row[]>(
    () =>
      live
        ? flattenLiveFileTreeV2((path) => childrenOf(state, props.files.normalizeDir(path)), expanded)
        : flattenFileTreeV2(model!, expanded),
    // `expanded` and the children read from `state`.
    [live, state, model],
  )
  const active = normalizeFileTreeV2Path(props.active ?? "")
  const [focused, setFocused] = useState<string>()
  const list = useVirtualRows({
    count: rows.length,
    key: (index) => rows[index]?.node.path ?? index,
    keep: focused ? rows.findIndex((row) => row.node.path === focused) : -1,
  })

  // Buff (#470): the tree store resets when the workspace changes, so the root is read again then.
  const root = state.dir[""]
  useEffect(() => {
    if (!live || root?.loaded || root?.loading) return
    void props.files.tree.list("")
  }, [live, root?.loaded, root?.loading, props.files])

  // Scroll to the active file when it changes, not when folders open and close.
  const scrolled = useRef<string>(undefined)
  useEffect(() => {
    if (!active) return void (scrolled.current = undefined)
    const index = rows.findIndex((row) => row.node.path === active)
    if (index < 0 || scrolled.current === active) return
    scrolled.current = active
    const range = list.virtualizer.range
    if (range && index >= range.startIndex && index <= range.endIndex) return
    list.virtualizer.scrollToIndex(index, { align: "auto" })
  }, [active, rows, list.virtualizer])

  useLayoutEffect(() => {
    list.root.current?.style.removeProperty("width")
    syncWidth(list.root.current)
  }, [rows, list.root])
  useLayoutEffect(() => syncWidth(list.root.current))

  const select = (node: FileTreeV2Node, action?: (file: FileNode) => void) =>
    action?.({ ...node, path: node.originalPath, absolute: node.originalPath })
  const toggle = (node: FileTreeV2Node) => {
    if (expanded(node.path)) return props.files.tree.collapse(node.originalPath)
    props.files.tree.expand(node.originalPath, live ? undefined : { list: false })
  }

  return (
    <div
      ref={list.root}
      data-component="file-tree-v2"
      data-total-rows={live ? rows.length : model!.total}
      style={{ position: "relative", height: list.total }}
    >
      {list.items.map((item) => {
        const row = rows[item.index]
        if (!row) return null
        const node = row.node
        const directory = node.type === "directory"
        const kind = props.kinds?.get(node.path)
        return (
          <div key={node.path} style={rowStyle(item.start, item.size)}>
            <WithRowMenu path={directory ? undefined : node.originalPath}>
              {(trigger) => (
                <button
                  {...trigger}
                  type="button"
                  data-slot="file-tree-v2-row"
                  data-path={node.path}
                  data-selected={node.path === active ? "" : undefined}
                  data-ignored={node.ignored ? "" : undefined}
                  className="relative"
                  style={{ paddingInlineStart: paddingStart(row.level, node.type) }}
                  aria-expanded={directory ? expanded(node.path) : undefined}
                  draggable={!directory && props.draggable !== false}
                  onDragStart={(event) => {
                    if (directory || props.draggable === false) return
                    event.dataTransfer.setData("text/plain", `file:${node.path}`)
                    event.dataTransfer.effectAllowed = "copy"
                  }}
                  onFocus={() => setFocused(node.path)}
                  onBlur={() => setFocused(undefined)}
                  onClick={() => (directory ? toggle(node) : select(node, props.onFileClick))}
                  onDoubleClick={() => !directory && select(node, props.onFileDoubleClick)}
                >
                  {Array.from({ length: row.level }, (_, index) => (
                    <div
                      key={index}
                      data-slot="file-tree-v2-guide"
                      style={{ insetInlineStart: paddingStart(index, "directory") + 8 }}
                    />
                  ))}
                  {directory ? (
                    <div
                      data-slot="file-tree-v2-chevron"
                      data-expanded={expanded(node.path) ? "" : undefined}
                      className="flex size-4 items-center justify-center"
                    >
                      <ChevronDown aria-hidden className="size-3.5" />
                    </div>
                  ) : (
                    <>
                      {row.level > 0 && <div className="w-4 shrink-0" />}
                      <FileIcon path={node.path} />
                    </>
                  )}
                  <span data-slot="file-tree-v2-label">
                    <bdi dir="auto">{directory ? node.path.split("/").at(-1) : node.name}</bdi>
                  </span>
                  {kind && !directory && (
                    <span data-slot="file-tree-v2-change" data-change={kindChange(kind)}>
                      {kindLabel(kind)}
                    </span>
                  )}
                </button>
              )}
            </WithRowMenu>
          </div>
        )
      })}
    </div>
  )
}

/** Keyboard over a flat result list driven from its filter: arrows move the highlight, Enter opens. */
export function applyFileListKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  files: readonly string[],
  highlighted: string | undefined,
  options: { onHighlight: (path: string) => void; onSelect: (path: string) => void },
) {
  if (files.length === 0) return
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const current = highlighted ? files.indexOf(highlighted) : -1
    const delta = event.key === "ArrowDown" ? 1 : -1
    const start = current === -1 ? (delta > 0 ? 0 : files.length - 1) : current + delta
    options.onHighlight(files[Math.max(0, Math.min(files.length - 1, start))]!)
    event.preventDefault()
    return
  }
  if (event.key !== "Enter") return
  const target = highlighted ?? files[0]
  if (!target) return
  options.onSelect(target)
  event.preventDefault()
}

export function FileList(props: {
  files: readonly string[]
  active?: string
  highlighted?: string
  kinds?: ReadonlyMap<string, Kind>
  id?: string
  role?: "listbox"
  optionID?: (path: string) => string
  onFileClick: (path: string) => void
  onFileDoubleClick?: (path: string) => void
}) {
  const active = normalizeFileTreeV2Path(props.active ?? "")
  const highlighted = normalizeFileTreeV2Path(props.highlighted ?? "")
  const [focused, setFocused] = useState<string>()
  const list = useVirtualRows({
    count: props.files.length,
    key: (index) => props.files[index] ?? index,
    keep: focused ? props.files.indexOf(focused) : -1,
  })

  useEffect(() => {
    const index = props.files.findIndex((file) => normalizeFileTreeV2Path(file) === highlighted)
    if (index < 0) return
    const range = list.virtualizer.range
    if (range && index >= range.startIndex && index <= range.endIndex) return
    list.virtualizer.scrollToIndex(index, { align: "auto" })
  }, [highlighted, props.files, list.virtualizer])

  useLayoutEffect(() => {
    list.root.current?.style.removeProperty("width")
    syncWidth(list.root.current)
  }, [props.files, list.root])

  return (
    <div
      ref={list.root}
      id={props.id}
      role={props.role}
      data-component="file-tree-v2"
      data-total-rows={props.files.length}
      style={{ position: "relative", height: list.total }}
    >
      {list.items.map((item) => {
        const path = props.files[item.index]
        if (path === undefined) return null
        const value = normalizeFileTreeV2Path(path)
        const selected = highlighted ? highlighted === value : active === value
        const kind = props.kinds?.get(value)
        return (
          <div key={path} style={rowStyle(item.start, item.size)}>
            <WithRowMenu path={path}>
              {(trigger) => (
                <button
                  {...trigger}
                  type="button"
                  id={props.optionID?.(path)}
                  role={props.role ? "option" : undefined}
                  aria-selected={props.role ? selected : undefined}
                  data-slot="file-tree-v2-row"
                  data-path={path}
                  data-selected={selected ? "" : undefined}
                  data-highlighted={highlighted === value ? "" : undefined}
                  style={{ paddingInlineStart: 8 }}
                  onFocus={() => setFocused(path)}
                  onBlur={() => setFocused(undefined)}
                  onClick={() => props.onFileClick(path)}
                  onDoubleClick={() => props.onFileDoubleClick?.(path)}
                >
                  <FileIcon path={path} />
                  <span data-slot="file-tree-v2-label">
                    {value.includes("/") && <span data-slot="file-tree-v2-directory">{getDirectory(value)}</span>}
                    <span data-slot="file-tree-v2-filename">{getFilename(value)}</span>
                  </span>
                  {kind && (
                    <span data-slot="file-tree-v2-change" data-change={kindChange(kind)}>
                      {kindLabel(kind)}
                    </span>
                  )}
                </button>
              )}
            </WithRowMenu>
          </div>
        )
      })}
    </div>
  )
}
