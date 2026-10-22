// The interface and code text sizes (#461), ported from the Solid window's text-size.ts as a store.
// The interface size scales the whole window: @buff/ui sizes its type in px, so the React window
// zooms its root by size / 14 (14 px is the design system's body text and the default). The code
// size is the --buff-code-font-size the code surfaces read (files, diffs, code blocks, terminal).
// Same storage key as the Solid window, kept by this window only.

import { createStore } from "../core/store"

export const UI = { min: 12, max: 20, base: 14 } as const
export const CODE = { min: 10, max: 24, base: 13 } as const
const TERMINAL_BASE = 14
const KEY = "buff.text-size"

export type TextSizes = { ui: number; code: number | undefined }

const clamp = (value: number, range: { min: number; max: number }) =>
  Math.min(range.max, Math.max(range.min, Math.round(value)))

function read(): TextSizes {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    const value = typeof stored === "object" && stored !== null ? stored : {}
    const ui = "ui" in value && typeof value.ui === "number" ? clamp(value.ui, UI) : UI.base
    const code = "code" in value && typeof value.code === "number" ? clamp(value.code, CODE) : undefined
    return { ui, code }
  } catch {
    return { ui: UI.base, code: undefined }
  }
}

export const textSize = createStore<TextSizes>(read())

function save(next: TextSizes) {
  textSize.set(() => next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Without storage the size lasts until the window restarts.
  }
  applyTextSize()
}

export const codeSize = (sizes: TextSizes) => sizes.code ?? CODE.base
/** The terminal follows the code size when one is set, else keeps its own. */
export const terminalSize = (sizes: TextSizes) => sizes.code ?? TERMINAL_BASE

export const setUiSize = (value: number) => save({ ...textSize.get(), ui: clamp(value, UI) })
export const setCodeSize = (value: number) => save({ ...textSize.get(), code: clamp(value, CODE) })
export const resetTextSize = () => save({ ui: UI.base, code: undefined })
/** Read the stored sizes again (another window, tests). */
export const reloadTextSize = () => textSize.set(() => read())

/** Put the sizes on the page; the default sizes write nothing. */
export function applyTextSize(root: HTMLElement = document.documentElement) {
  const current = textSize.get()
  if (current.ui === UI.base) root.style.removeProperty("zoom")
  else root.style.setProperty("zoom", String(current.ui / UI.base))
  if (current.code === undefined) root.style.removeProperty("--buff-code-font-size")
  else root.style.setProperty("--buff-code-font-size", `${current.code}px`)
}
