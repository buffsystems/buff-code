// The command palette (#584), the Solid DialogCommandPalette: commands, the shown session's files
// and the server's sessions, grouped, searched as you type — remote results append without moving
// the selection, which stays on the entry it was on.

import { Dialog, Input, Kbd } from "@buff/ui/react"
import { getDirectory, getFilename } from "@opencode/util/path"
import { Search } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useI18n } from "../i18n/provider"
import { formatKeybindParts, type KeyLabel } from "./keybind"
import {
  commandEntry,
  fileEntry,
  matchesEntry,
  preferredCommands,
  recentFiles,
  type PaletteEntry,
  type PaletteSource,
} from "./palette-entries"
import { usePaletteSearch } from "./palette-search"
import type { CommandOption, CommandRegistry } from "./registry"
import "./palette.css"

/** What the window adds to the palette where it is shown: sources, recent files, how to open results. */
export type PaletteContext = {
  /** On Home: commands and sessions only, the first few commands with no query. */
  home: boolean
  sources: PaletteSource[]
  recentFiles: () => { paths: string[]; active?: string }
  openFile: (path: string) => void
  openSession: (entry: PaletteEntry) => void
}

/** Every word of the query appears in the title, description or category. */
export function filterCommands(options: CommandOption[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return options
  return options.filter((option) => {
    const text = [option.title, option.description, option.category].join(" ").toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

const NO_SOURCES: PaletteSource[] = []

export function CommandPalette(props: { registry: CommandRegistry; context?: PaletteContext; onClose: () => void }) {
  const i18n = useI18n()
  const context = props.context
  const [query, setQuery] = useState("")
  const [active, setActive] = useState<string>()
  const results = useRef<HTMLDivElement>(null)
  const commands = i18n.t("palette.group.commands")
  const filesCategory = i18n.t("palette.group.files")

  const items = (text: string) => {
    const options = props.registry.palette()
    if (text)
      return options.map((option) => commandEntry(option, commands)).filter((entry) => matchesEntry(entry, text))
    if (!context || context.home) return options.slice(0, 5).map((option) => commandEntry(option, commands))
    const files = context.recentFiles()
    return [
      ...preferredCommands(options).map((option) => commandEntry(option, commands)),
      ...recentFiles(files.paths, files.active).map((path) => fileEntry(path, filesCategory)),
    ]
  }
  const search = usePaletteSearch({ query, items, sources: context?.sources ?? NO_SOURCES })
  const entries = search.items
  // Pin the automatic selection too: a later source can insert rows before it.
  const current = entries.find((entry) => entry.id === active) ?? entries[0]
  useEffect(() => {
    if (current && current.id !== active) setActive(current.id)
  }, [current?.id, active])

  const select = (entry: PaletteEntry | undefined) => {
    if (!entry) return
    props.onClose()
    if (entry.type === "command") return entry.option?.onSelect?.("palette")
    if (entry.type === "session") return context?.openSession(entry)
    if (entry.path) context?.openFile(entry.path)
  }
  const move = (delta: 1 | -1) => {
    if (entries.length === 0) return
    const index = entries.findIndex((entry) => entry.id === current?.id)
    setActive(entries[(index + delta + entries.length) % entries.length]?.id)
    requestAnimationFrame(() => results.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" }))
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") move(1)
    if (event.key === "ArrowUp") move(-1)
    if (event.key === "Enter") select(current)
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") event.preventDefault()
  }
  const groups = entries.reduce(
    (map, entry) => map.set(entry.category, [...(map.get(entry.category) ?? []), entry]),
    new Map<string, PaletteEntry[]>(),
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={i18n.t("command.palette")}
      closeLabel={i18n.t("common.close")}
      size="lg"
    >
      <div data-component="command-palette" className="command-palette">
        <Input
          autoFocus
          autoComplete="off"
          spellCheck={false}
          leadingIcon={Search}
          placeholder={i18n.t(context?.home ? "palette.search.placeholder.home" : "palette.search.placeholder")}
          aria-label={i18n.t("command.palette")}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setActive(undefined)
          }}
          onKeyDown={onKeyDown}
        />
        <div ref={results} role="listbox" className="command-palette__results">
          {entries.length === 0 && (
            <p className="command-palette__state ui-note">
              {search.loading ? i18n.t("common.loading") : i18n.t("palette.empty")}
            </p>
          )}
          {[...groups].map(([category, list]) => (
            <div key={category} className="command-palette__group">
              {category && <div className="command-palette__group-title">{category}</div>}
              {list.map((entry) => (
                <PaletteRow
                  key={entry.id}
                  entry={entry}
                  active={entry.id === current?.id}
                  onActive={() => setActive(entry.id)}
                  onSelect={() => select(entry)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}

function PaletteRow(props: { entry: PaletteEntry; active: boolean; onActive: () => void; onSelect: () => void }) {
  const i18n = useI18n()
  const entry = props.entry
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.active}
      data-active={props.active ? "" : undefined}
      className="command-palette__row"
      onMouseMove={(event) => {
        // A static cursor under rows moved by the keyboard does not take the selection.
        if (event.movementX === 0 && event.movementY === 0) return
        props.onActive()
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onSelect}
    >
      {entry.type === "file" ? (
        <span className="command-palette__file">
          <span className="command-palette__file-dir">{getDirectory(entry.path)}</span>{" "}
          <span className="command-palette__file-name">{getFilename(entry.path)}</span>
        </span>
      ) : (
        <span className="command-palette__text">
          <span className="command-palette__title">{entry.title}</span>
          {entry.description && <span className="command-palette__description">{entry.description}</span>}
        </span>
      )}
      {entry.type === "command" && entry.keybind && (
        <span className="flex gap-1">
          {formatKeybindParts(entry.keybind, (key: KeyLabel) => i18n.t(key)).map((part) => (
            <Kbd key={part}>{part}</Kbd>
          ))}
        </span>
      )}
    </button>
  )
}
