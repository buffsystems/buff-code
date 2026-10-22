export * as BuffTextSize from "./text-size"

import { createSignal } from "solid-js"

/**
 * Размер шрифта интерфейса и кода (#461). Интерфейс — размер основного текста, через множитель:
 * его применяют размеры, переписанные при сборке (`vite.buff-text-scale.js`). Код — свой
 * размер для моноширинного текста: файлы, изменения, блоки кода, терминал. Хранится у этого
 * окна; по умолчанию основной текст 14 px, как в кабинете Buff (#471).
 */

export const UI = { min: 12, max: 20, base: 14 } as const
/** Основной текст апстрима — 13 px: множитель считается от него, и «14 px» в настройках — это 14 px (#471). */
const UPSTREAM_TEXT = 13
export const CODE = { min: 10, max: 24, base: 13 } as const
const TERMINAL_BASE = 14
const KEY = "buff.text-size"

type Sizes = { ui: number; code: number | undefined }

function read(): Sizes {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Sizes>
    return {
      ui: typeof stored.ui === "number" ? clamp(stored.ui, UI) : UI.base,
      code: typeof stored.code === "number" ? clamp(stored.code, CODE) : undefined,
    }
  } catch {
    return { ui: UI.base, code: undefined }
  }
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

const [sizes, setSizes] = createSignal<Sizes>(read())

function save(next: Sizes): void {
  setSizes(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Без хранилища размер живёт до перезапуска окна.
  }
  apply()
}

export const ui = (): number => sizes().ui
export const code = (): number => sizes().code ?? CODE.base
/** Размер терминала: свой размер кода, если задан, иначе прежний размер терминала. */
export const terminal = (): number => sizes().code ?? TERMINAL_BASE

export const setUi = (value: number): void => save({ ...sizes(), ui: clamp(value, UI) })
export const setCode = (value: number): void => save({ ...sizes(), code: clamp(value, CODE) })
export const reset = (): void => save({ ui: UI.base, code: undefined })
/** Перечитать из хранилища (тесты, другое окно). */
export const reload = (): void => void setSizes(read())

/** Записать размеры в стили страницы; размер кода по умолчанию не пишется. */
export function apply(root: HTMLElement = document.documentElement): void {
  const current = sizes()
  root.style.setProperty("--buff-ui-scale", String(current.ui / UPSTREAM_TEXT))
  if (current.code === undefined) root.style.removeProperty("--buff-code-font-size")
  else root.style.setProperty("--buff-code-font-size", `${current.code}px`)
}

/** В корне приложения: применить размеры до первого кадра. */
export function Root(): null {
  apply()
  return null
}
