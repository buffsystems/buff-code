// The keyboard shortcuts' logic (#584), ported from the Solid window's keybinds.tsx: which commands
// are listed and in which group, the keybind each has now, recording a new one from a key press —
// refused without a modifier, confirmed when it takes another command's keys (#460) — and finding
// commands by name or by pressed keys.

import { BuffKeybinds } from "@opencode/app/react-reuse/keybind-rules"
import fuzzysort from "fuzzysort"
import { isMac, keyFromKeyboardEvent, parseKeybind } from "../../commands/keybind"
import { DEFAULT_PALETTE_KEYBIND, PALETTE_ID, type CommandOption } from "../../commands/registry"
import type { CommandCatalog } from "../../commands/catalog"
import { createStore } from "../../core/store"

export const GROUPS = ["General", "Session", "Navigation", "Model and agent", "Terminal", "Prompt"] as const
export type KeybindGroup = (typeof GROUPS)[number]

export const groupKey = {
  General: "settings.shortcuts.group.general",
  Session: "settings.shortcuts.group.session",
  Navigation: "settings.shortcuts.group.navigation",
  "Model and agent": "settings.shortcuts.group.modelAndAgent",
  Terminal: "settings.shortcuts.group.terminal",
  Prompt: "settings.shortcuts.group.prompt",
} as const satisfies Record<KeybindGroup, string>

export type KeybindEntry = { title: string; group: KeybindGroup }

export function groupFor(id: string): KeybindGroup {
  if (id === PALETTE_ID) return "General"
  if (id.startsWith("terminal.")) return "Terminal"
  if (id.startsWith("model.") || id.startsWith("agent.") || id.startsWith("mcp.")) return "Model and agent"
  if (id.startsWith("file.") || id.startsWith("fileTree.")) return "Navigation"
  if (id.startsWith("prompt.")) return "Prompt"
  const session = ["session.", "message.", "permissions.", "steps.", "review."]
  if (session.some((prefix) => id.startsWith(prefix))) return "Session"
  return "General"
}

/** A pressed combination in config form ("mod+shift+k"); nothing for a lone modifier. */
export function recordKeybind(event: KeyboardEvent, mac = isMac()) {
  if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return undefined
  const key = keyFromKeyboardEvent(event)
  if (!key) return undefined
  const parts = [
    (mac ? event.metaKey : event.ctrlKey) && "mod",
    mac && event.ctrlKey && "ctrl",
    !mac && event.metaKey && "meta",
    event.altKey && "alt",
    event.shiftKey && "shift",
    key,
  ]
  return parts.filter((part) => typeof part === "string").join("+")
}

/** Comparable signatures of every combination in a config. */
export function signatures(config: string | undefined) {
  if (!config) return []
  return parseKeybind(config).flatMap((keybind) => {
    const parts = [
      keybind.ctrl && "ctrl",
      keybind.alt && "alt",
      keybind.shift && "shift",
      keybind.meta && "meta",
      keybind.key,
    ].filter((part) => typeof part === "string" && part.length > 0)
    return parts.length ? [parts.join("+")] : []
  })
}

/** Every command the shortcuts list: the palette, the catalog, the live options, then set overrides. */
export function keybindList(input: {
  catalog: CommandCatalog
  options: readonly CommandOption[]
  overrides: Record<string, string>
  paletteTitle: string
  title: (title: string) => string
}) {
  const list = new Map<string, KeybindEntry>([[PALETTE_ID, { title: input.paletteTitle, group: "General" }]])
  Object.entries(input.catalog).forEach(([id, item]) => {
    if (id.startsWith("suggested.") || item.hidden) return
    list.set(id, { title: input.title(item.title), group: groupFor(id) })
  })
  input.options.forEach((option) => {
    if (option.id.startsWith("suggested.") || option.hidden) return
    list.set(option.id, { title: option.title, group: groupFor(option.id) })
  })
  Object.keys(input.overrides).forEach((id) => {
    if (!list.has(id)) list.set(id, { title: id, group: groupFor(id) })
  })
  return list
}

/** The commands of each group, by title; with a query, the fuzzy matches by title or keys. */
export function filterKeybinds(query: string, list: Map<string, KeybindEntry>, keybind: (id: string) => string) {
  const groups = new Map<KeybindGroup, string[]>(GROUPS.map((group) => [group, []]))
  const value = query.toLowerCase().trim()
  if (!value) {
    list.forEach((entry, id) => groups.get(entry.group)?.push(id))
    groups.forEach((ids) => ids.sort((a, b) => (list.get(a)?.title ?? "").localeCompare(list.get(b)?.title ?? "")))
    return groups
  }
  const items = [...list].map(([id, entry]) => ({ id, title: entry.title, group: entry.group, keybind: keybind(id) }))
  fuzzysort
    .go(value, items, { keys: ["title", "keybind"], threshold: -10000 })
    .forEach((result) => groups.get(result.obj.group)?.push(result.obj.id))
  return groups
}

export type Confirm = (input: { title: string; text: string; action: string }) => Promise<boolean>

/**
 * Recording one command's keys: `toggle` starts or stops listening, `handle` takes the window's
 * key presses while listening (capture phase), `combo` listens for keys to filter by.
 */
export function createKeybindCapture(input: {
  suspend: () => () => void
  set: (id: string, keybind: string) => void
  /** Commands that already use a signature, for the conflict check. */
  used: () => Map<string, { id: string; title: string }[]>
  title: (id: string) => string
  /** «{keys} is already used by …» — asks to reassign; true when the person agreed. */
  confirmConflict: (input: { keys: string; commands: string[]; title: string; count: number }) => Promise<boolean>
}) {
  const store = createStore({
    active: undefined as string | undefined,
    problem: undefined as { id: string; text: string } | undefined,
    combo: false,
    comboFilter: undefined as string[] | undefined,
  })
  const resume = { current: undefined as (() => void) | undefined }
  const listen = () => {
    resume.current?.()
    resume.current = input.suspend()
  }
  const release = () => {
    resume.current?.()
    resume.current = undefined
  }
  const stop = () => {
    store.set((state) => ({ ...state, problem: undefined, active: undefined }))
    release()
  }

  const handle = (event: KeyboardEvent) => {
    const state = store.get()
    if (state.combo) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (event.key === "Escape") {
        store.set((current) => ({ ...current, combo: false }))
        return release()
      }
      const pressed = recordKeybind(event)
      if (!pressed) return
      store.set((current) => ({ ...current, combo: false, comboFilter: signatures(pressed) }))
      return release()
    }
    const id = state.active
    if (!id) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (event.key === "Escape") return stop()
    const modified = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
    if ((event.key === "Backspace" || event.key === "Delete") && !modified) {
      input.set(id, "none")
      return stop()
    }
    const next = recordKeybind(event)
    if (!next) return
    const problem = BuffKeybinds.problem(next)
    if (problem) {
      store.set((current) => ({ ...current, problem: { id, text: problem } }))
      return
    }
    const conflicts = new Map<string, string>()
    signatures(next).forEach((signature) =>
      (input.used().get(signature) ?? []).forEach((item) => {
        if (item.id !== id) conflicts.set(item.id, item.title)
      }),
    )
    stop()
    if (!conflicts.size) return input.set(id, next)
    void input
      .confirmConflict({ keys: next, commands: [...conflicts.values()], title: input.title(id), count: conflicts.size })
      .then((yes) => {
        if (!yes) return
        conflicts.forEach((_, other) => input.set(other, "none"))
        input.set(id, next)
      })
  }

  return {
    store,
    handle,
    toggle(id: string) {
      if (store.get().active === id) return stop()
      store.set((state) => ({ ...state, problem: undefined, active: id }))
      listen()
    },
    stop,
    combo: {
      start() {
        store.set((state) => ({ ...state, active: undefined, problem: undefined, combo: true }))
        listen()
      },
      clear() {
        store.set((state) => ({ ...state, combo: false, comboFilter: undefined }))
        release()
      },
    },
    dispose: release,
  }
}

export { DEFAULT_PALETTE_KEYBIND, PALETTE_ID }
