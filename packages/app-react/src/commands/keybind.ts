// Keybinds (#584): parsing, matching and labels of "mod+shift+p"-style configs, ported from the
// Solid window's command.tsx (its logic lives in a Solid module, so it cannot be imported).

export type Keybind = { key: string; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }

export type KeyLabel =
  | "common.key.ctrl"
  | "common.key.alt"
  | "common.key.shift"
  | "common.key.meta"
  | "common.key.space"
  | "common.key.backspace"
  | "common.key.enter"
  | "common.key.tab"
  | "common.key.delete"
  | "common.key.home"
  | "common.key.end"
  | "common.key.pageUp"
  | "common.key.pageDown"
  | "common.key.insert"
  | "common.key.esc"

export const isMac = () => typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

function normalizeKey(key: string) {
  if (key === ",") return "comma"
  if (key === "+") return "plus"
  if (key === " ") return "space"
  return key.toLowerCase()
}

/** The key of an event; with Alt, the physical letter (Alt+letter types a symbol on macOS). */
export function keyFromKeyboardEvent(event: KeyboardEvent) {
  const key = normalizeKey(event.key)
  if (!event.altKey || /^[a-z0-9]$/.test(key)) return key
  if (!event.code.startsWith("Key") || event.code.length !== 4) return key
  return event.code.slice(3).toLowerCase()
}

export function signature(keybind: Keybind) {
  const mask = (keybind.ctrl ? 1 : 0) | (keybind.meta ? 2 : 0) | (keybind.shift ? 4 : 0) | (keybind.alt ? 8 : 0)
  return `${keybind.key}:${mask}`
}

export function signatureFromEvent(event: KeyboardEvent) {
  return signature({
    key: keyFromKeyboardEvent(event),
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })
}

/** "mod+k,mod+shift+p" → one keybind per comma-separated combo; "mod" is ⌘ on macOS, Ctrl elsewhere. */
export function parseKeybind(config: string, mac = isMac()): Keybind[] {
  if (!config || config === "none") return []
  return config.split(",").map((combo) =>
    combo
      .trim()
      .toLowerCase()
      .split("+")
      .reduce<Keybind>(
        (keybind, part) => {
          if (part === "ctrl" || part === "control") return { ...keybind, ctrl: true }
          if (part === "meta" || part === "cmd" || part === "command") return { ...keybind, meta: true }
          if (part === "mod") return mac ? { ...keybind, meta: true } : { ...keybind, ctrl: true }
          if (part === "alt" || part === "option") return { ...keybind, alt: true }
          if (part === "shift") return { ...keybind, shift: true }
          return { ...keybind, key: part }
        },
        { key: "", ctrl: false, meta: false, shift: false, alt: false },
      ),
  )
}

export function matchKeybind(keybinds: Keybind[], event: KeyboardEvent) {
  const key = keyFromKeyboardEvent(event)
  return keybinds.some(
    (keybind) =>
      keybind.key === key &&
      keybind.ctrl === event.ctrlKey &&
      keybind.meta === event.metaKey &&
      keybind.shift === event.shiftKey &&
      keybind.alt === event.altKey,
  )
}

const symbols: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  comma: ",",
  plus: "+",
}
const named: Record<string, KeyLabel> = {
  backspace: "common.key.backspace",
  delete: "common.key.delete",
  end: "common.key.end",
  enter: "common.key.enter",
  esc: "common.key.esc",
  escape: "common.key.esc",
  home: "common.key.home",
  insert: "common.key.insert",
  pagedown: "common.key.pageDown",
  pageup: "common.key.pageUp",
  space: "common.key.space",
  tab: "common.key.tab",
}

/** Display parts of a config's first combo: modifier glyphs on macOS, translated names elsewhere. */
export function formatKeybindParts(config: string, t: (key: KeyLabel) => string, mac = isMac()) {
  const keybind = parseKeybind(config, mac)[0]
  if (!keybind) return []
  const modifiers = [
    keybind.ctrl ? (mac ? "⌃" : t("common.key.ctrl")) : undefined,
    keybind.alt ? (mac ? "⌥" : t("common.key.alt")) : undefined,
    keybind.shift ? (mac ? "⇧" : t("common.key.shift")) : undefined,
    keybind.meta ? (mac ? "⌘" : t("common.key.meta")) : undefined,
  ].filter((part) => part !== undefined)
  if (!keybind.key) return modifiers
  const key = keybind.key
  const label = named[key]
  const display =
    symbols[key] ??
    (label ? t(label) : key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1))
  return [...modifiers, display]
}

export function formatKeybind(config: string, t: (key: KeyLabel) => string, mac = isMac()) {
  return formatKeybindParts(config, t, mac).join(mac ? "" : "+")
}

/** Typing targets keep plain keys to themselves. */
export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest("[contenteditable='true'], input, textarea, select") !== null
}
