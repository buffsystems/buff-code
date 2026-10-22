// The command registry (#584), ported from the Solid window's CommandProvider without Solid:
// screens register command lists under a key (a newer registration of a key replaces the older),
// keybinds dispatch from one capture listener, and the palette lists what is enabled.

import { createStore } from "../core/store"
import { isEditableTarget, parseKeybind, signature, signatureFromEvent } from "./keybind"

export const PALETTE_ID = "command.palette"
export const DEFAULT_PALETTE_KEYBIND = "mod+k,mod+shift+p"
const SUGGESTED_PREFIX = "suggested."
const EDITABLE_KEYBIND_IDS = new Set(["terminal.toggle", "terminal.new", "file.attach", "browser.reload"])

export type CommandSource = "palette" | "keybind" | "slash"

export type CommandOption = {
  id: string
  title: string
  description?: string
  category?: string
  keybind?: string
  slash?: string
  suggested?: boolean
  disabled?: boolean
  hidden?: boolean
  when?: (event: KeyboardEvent) => boolean
  onSelect?: (source?: CommandSource) => void
}

type Registration = { key?: string; options: () => CommandOption[] }

export function createCommandRegistry(input: {
  /** A keybind the person set in settings, by action id. */
  keybindOverride?: (id: string) => string | undefined
  /** The "Suggested" category label. */
  suggestedCategory?: () => string
  /** A modal is open: keybinds stay with it. */
  blocked?: () => boolean
}) {
  const registrations = createStore<Registration[]>([])
  const suspension = { count: 0 }
  const bind = (id: string, fallback: string | undefined) => {
    const config = input.keybindOverride?.(actionId(id)) ?? fallback
    return config && config !== "none" ? config : undefined
  }

  // Every registered option once, newest registration first, with its own default keybind.
  const active = () => {
    const keys = new Set<string>()
    const ids = new Set<string>()
    return registrations
      .get()
      .filter((entry) => {
        if (entry.key === undefined) return true
        if (keys.has(entry.key)) return false
        keys.add(entry.key)
        return true
      })
      .flatMap((entry) => entry.options())
      .filter((option) => {
        if (ids.has(option.id)) return false
        ids.add(option.id)
        return true
      })
  }

  const registered = () => active().map((option) => ({ ...option, keybind: bind(option.id, option.keybind) }))

  const options = () => {
    const resolved = registered()
    const suggested = resolved
      .filter((option) => option.suggested && !option.disabled)
      .map((option) => ({ ...option, id: SUGGESTED_PREFIX + option.id, category: input.suggestedCategory?.() }))
    return [...suggested, ...resolved]
  }

  const find = (id: string) => options().find((option) => option.id === id || actionId(option.id) === id)
  const run = (id: string, source?: CommandSource) => find(id)?.onSelect?.(source)

  const keymap = () =>
    options().reduce((map, option) => {
      if (option.id.startsWith(SUGGESTED_PREFIX) || option.disabled || !option.keybind) return map
      parseKeybind(option.keybind)
        .filter((keybind) => keybind.key)
        .forEach((keybind) => map.set(signature(keybind), [...(map.get(signature(keybind)) ?? []), option]))
      return map
    }, new Map<string, CommandOption[]>())

  const paletteKeybind = () => input.keybindOverride?.(PALETTE_ID) ?? DEFAULT_PALETTE_KEYBIND

  function handleKeyDown(event: KeyboardEvent) {
    if (suspension.count > 0 || input.blocked?.()) return
    const sig = signatureFromEvent(event)
    const palette = parseKeybind(paletteKeybind()).some((keybind) => signature(keybind) === sig)
    const candidates = keymap().get(sig)
    const option = candidates?.find((item) => item.when?.(event)) ?? candidates?.find((item) => !item.when)
    const modified = event.ctrlKey || event.metaKey || event.altKey
    const editableAllowed = option !== undefined && EDITABLE_KEYBIND_IDS.has(actionId(option.id))
    if (isEditableTarget(event.target) && !palette && !editableAllowed && !modified && event.key !== "Tab") return
    if (!palette && !option) return
    event.preventDefault()
    event.stopPropagation()
    if (palette) return run(PALETTE_ID, "palette")
    option?.onSelect?.("keybind")
  }

  return {
    /** Register a command list; returns its unregister. A newer list under the same key wins. */
    register(key: string | undefined, list: () => CommandOption[]) {
      const entry: Registration = { key, options: list }
      registrations.set((current) => [entry, ...current])
      return () => registrations.set((current) => current.filter((item) => item !== entry))
    },
    options,
    /** The registered options with their default keybinds, before the person's overrides. */
    registered: active,
    /** What the palette offers: enabled, visible, not the suggested duplicates. */
    palette: () =>
      options().filter((option) => !option.disabled && !option.hidden && !option.id.startsWith(SUGGESTED_PREFIX)),
    trigger: run,
    keybind: (id: string) => (id === PALETTE_ID ? paletteKeybind() : find(id)?.keybind),
    handleKeyDown,
    /** Suspend keybinds while something owns the keyboard (a capture in settings). */
    suspend() {
      suspension.count++
      return () => {
        suspension.count = Math.max(0, suspension.count - 1)
      }
    },
    changes: registrations,
  }
}

export type CommandRegistry = ReturnType<typeof createCommandRegistry>

function actionId(id: string) {
  return id.startsWith(SUGGESTED_PREFIX) ? id.slice(SUGGESTED_PREFIX.length) : id
}
