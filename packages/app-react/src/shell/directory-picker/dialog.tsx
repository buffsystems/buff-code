// The in-app folder picker (#584), the Solid DirectoryPickerDialog for a server the window reaches
// over HTTP: a path field with folder suggestions, Home / Root / Parent, the server's folders as a
// lazily listed tree (Pierre's trees), and «Select folder» for the chosen one or the shown root.

import "@pierre/trees/web-components"
import { FileTree } from "@pierre/trees"
import { Button, Dialog, DialogBody, DialogFooter, Input } from "@buff/ui/react"
import {
  absoluteTreePath,
  activeTreeNavigation,
  advanceTreePreload,
  cleanPickerInput,
  createDirectorySearch,
  createPriorityTaskQueue,
  currentPickerSuggestions,
  displayPickerPath,
  listPickerDirectory,
  nextSuggestionIndex,
  nextTreeScrollTop,
  pickerAbsoluteInput,
  pickerMode,
  pickerParent,
  pickerRoot,
  preloadTreeDirectories,
} from "@opencode/app/react-reuse/directory-picker"
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { pickerSdk } from "./sdk"
import "./dialog.css"

type Listing = { name: string; type: "file" | "directory" }
type Suggestions = { query: string; items: string[] }

const TREE_CSS = `
  button[data-type="item"] { background: transparent !important; box-shadow: none !important; }
  button[data-type="item"]:hover { background: var(--muted) !important; }
  button[data-type="item"]:focus-visible { outline: none !important; box-shadow: none !important; }
  [data-file-tree-virtualized-scroll] { overscroll-behavior: contain; scrollbar-width: thin; }
`

export function DirectoryPickerDialog(props: {
  server: Server
  title: string
  onSelect: (path: string | undefined) => void
}) {
  const i18n = useI18n()
  const sdk = useMemo(() => pickerSdk(props.server), [props.server])
  const policy = useMemo(() => pickerMode("directory"), [])
  const [location, setLocation] = useState<{ directory: string }>()
  const [root, setRoot] = useState("")
  const [input, setInput] = useState("")
  const [selected, setSelected] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [valid, setValid] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestions>()
  // Radix mounts the dialog's content after its portal: the tree attaches once the element exists.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const pathArea = useRef<HTMLDivElement>(null)
  const state = useRef({
    tree: undefined as FileTree | undefined,
    navigation: 0,
    root: "",
    listings: new Map<string, Promise<Listing[] | undefined>>(),
    advanced: new Set<string>(),
    loads: createPriorityTaskQueue<Listing[] | undefined>(3),
  })
  const home = ""
  const search = useMemo(
    () =>
      createDirectorySearch({
        sdk,
        home: () => home,
        location: () => location,
        base: () => state.current.root || location?.directory,
      }),
    [sdk, location],
  )
  const items = currentPickerSuggestions(suggestions, input)
  const result = policy.result(root, selected, valid)

  const load = async (path: string, generation: number, eager = false): Promise<boolean> => {
    const current = state.current
    const key = path.replace(/\/+$/, "")
    setError(false)
    const absolute = absoluteTreePath(current.root, key)
    const existing = current.listings.get(key)
    if (existing && !eager) current.loads.promote(`${generation}:${key}`)
    const request =
      existing ??
      current.loads.schedule(`${generation}:${key}`, eager ? "background" : "user", () => {
        if (!activeTreeNavigation(generation, current.navigation) || !location) return Promise.resolve(undefined)
        return listPickerDirectory(sdk, location, absolute).catch(() => undefined)
      })
    current.listings.set(key, request)
    const nodes = await request
    if (!activeTreeNavigation(generation, current.navigation)) return false
    if (!nodes) {
      current.listings.delete(key)
      if (!key) setError(true)
      return false
    }
    current.tree?.batch(policy.entries(key, nodes).map((item) => ({ type: "add" as const, path: item })))
    if (!eager && advanceTreePreload(current.advanced, key))
      preloadTreeDirectories(key, nodes).forEach((directory) => void load(directory, generation, true))
    return true
  }
  const loadRef = useRef(load)
  loadRef.current = load

  const navigate = async (path: string) => {
    const current = state.current
    const value = policy.navigation(
      pickerAbsoluteInput(cleanPickerInput(path), home, current.root || location?.directory || home),
    )
    if (!value) return
    const token = ++current.navigation
    setLoading(true)
    setValid(false)
    setSelected("")
    setOpen(false)
    setActive(-1)
    current.root = value
    setRoot(value)
    setInput(displayPickerPath(value, value, home))
    current.listings.clear()
    current.advanced.clear()
    current.tree?.resetPaths([])
    const ok = await loadRef.current("", token)
    if (!activeTreeNavigation(token, current.navigation)) return
    setValid(ok)
    setLoading(false)
  }

  // Where the server stands: the first folder shown.
  useEffect(() => {
    const live = { value: true }
    void props.server
      .api()
      .location.get()
      .then((value) => live.value && setLocation({ directory: value.directory }))
      .catch(() => undefined)
    return () => {
      live.value = false
    }
  }, [props.server])
  useEffect(() => {
    if (location && !state.current.root) void navigate(location.directory)
  }, [location])

  useEffect(() => {
    const element = container
    if (!element) return
    const tree = new FileTree({
      paths: [],
      flattenEmptyDirectories: false,
      initialExpansion: "closed",
      stickyFolders: true,
      unsafeCSS: TREE_CSS,
      onExpansionChange(change) {
        if (change.expanded) void loadRef.current(change.path, state.current.navigation)
      },
      onSelectionChange(paths) {
        const path = paths.at(-1)
        setSelected(path ? (policy.selection(state.current.root, path) ?? "") : "")
      },
    })
    tree.render({ containerWrapper: element })
    tree.getFileTreeContainer()?.classList.add("directory-picker-tree")
    state.current.tree = tree
    const close = (event: PointerEvent) => {
      if (pathArea.current?.contains(event.target as Node)) return
      setOpen(false)
      setActive(-1)
    }
    document.addEventListener("pointerdown", close)
    return () => {
      document.removeEventListener("pointerdown", close)
      tree.cleanUp()
      state.current.tree = undefined
    }
  }, [policy, container])

  // Folder suggestions for what is typed; an older query's answer is dropped.
  useEffect(() => {
    const cleaned = cleanPickerInput(input)
    const current = displayPickerPath(root, input, home).replace(/\/+$/, "")
    if (!cleaned || (root && cleaned.replace(/\/+$/, "") === current))
      return setSuggestions({ query: input, items: [] })
    const live = { value: true }
    void search(input).then((found) => live.value && setSuggestions({ query: input, items: found.slice(0, 5) }))
    return () => {
      live.value = false
    }
  }, [input, root, search])

  const choose = (path: string) => void navigate(path)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      setActive((current) => nextSuggestionIndex(current, event.key === "ArrowDown" ? 1 : -1, items.length))
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const match = items[active] ?? items[0]
      if (match) choose(match)
      if (!match) void navigate(input)
    }
    if (event.key === "Tab" && !event.shiftKey) {
      const match = items[active] ?? items[0]
      if (!match) return
      event.preventDefault()
      const value = displayPickerPath(match, input, home)
      setInput(value.endsWith("/") ? value : value + "/")
    }
  }

  return (
    <Dialog
      open
      size="lg"
      title={props.title}
      closeLabel={i18n.t("common.close")}
      onOpenChange={(next) => !next && props.onSelect(undefined)}
    >
      <DialogBody className="directory-picker-body">
        <div className="directory-picker-path" ref={pathArea}>
          <Input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="w-full"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="directory-picker-suggestions"
            aria-activedescendant={active >= 0 ? `directory-picker-suggestion-${active}` : undefined}
            value={input}
            onChange={(event) => {
              setInput(cleanPickerInput(event.currentTarget.value))
              setSelected("")
              setOpen(true)
              setActive(-1)
            }}
            onKeyDown={onKeyDown}
          />
          <div className="directory-picker-actions">
            <Button size="sm" variant="ghost" onClick={() => void navigate(pickerRoot(root) || root)}>
              {i18n.t("dialog.directory.root")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void navigate(pickerParent(root))}>
              {i18n.t("dialog.directory.parent")}
            </Button>
          </div>
          {open && items.length > 0 && (
            <div id="directory-picker-suggestions" role="listbox" className="directory-picker-suggestions">
              {items.map((path, index) => (
                <button
                  key={path}
                  type="button"
                  id={`directory-picker-suggestion-${index}`}
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active ? "" : undefined}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(path)}
                >
                  {displayPickerPath(path, input, home)}/
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          ref={setContainer}
          className="directory-picker-browser"
          onWheel={(event) => {
            const scroller = state.current.tree
              ?.getFileTreeContainer()
              ?.shadowRoot?.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll]")
            if (!scroller) return
            const next = nextTreeScrollTop(
              scroller.scrollTop,
              event.deltaY,
              scroller.scrollHeight,
              scroller.clientHeight,
            )
            if (next === scroller.scrollTop) return
            event.preventDefault()
            scroller.scrollTop = next
            scroller.dispatchEvent(new Event("scroll"))
          }}
        >
          {loading && <div className="directory-picker-state">{i18n.t("common.loading")}</div>}
          {!loading && error && <div className="directory-picker-state">{i18n.t("dialog.directory.readError")}</div>}
        </div>
        <div className="directory-picker-selection">{result}</div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => props.onSelect(undefined)}>
          {i18n.t("common.cancel")}
        </Button>
        <Button disabled={!result} onClick={() => props.onSelect(result)}>
          {i18n.t("dialog.directory.action.selectFolder")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
