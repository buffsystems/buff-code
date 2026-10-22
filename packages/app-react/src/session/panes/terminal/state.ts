// A workspace's terminals as plain data (#584): the PTY list and the active one, with the Solid
// window's rules for numbering, closing, moving and dropping exited PTYs. Pure functions only.

import { titleNumber } from "@opencode/app/react-reuse/terminal-title"

export type LocalPTY = {
  id: string
  title: string
  titleNumber: number
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
  cursor?: number
}

export type TerminalState = { active?: string; all: LocalPTY[] }

export const MAX_TERMINAL_SESSIONS = 20
export const EMPTY_TERMINALS: TerminalState = { all: [] }

const numberFromTitle = (title: string) => titleNumber(title, MAX_TERMINAL_SESSIONS)
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

/** The stored state as the Solid window writes it: duplicates dropped, numbers recovered from titles. */
export function decodeTerminals(raw: string): TerminalState | undefined {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== "object" || value === null || !("all" in value) || !Array.isArray(value.all)) return
  const seen = new Set<string>()
  const all = value.all.flatMap((item: unknown): LocalPTY[] => {
    if (typeof item !== "object" || item === null) return []
    const pty = item as Record<string, unknown>
    if (typeof pty.id !== "string" || !pty.id || seen.has(pty.id)) return []
    seen.add(pty.id)
    const title = typeof pty.title === "string" ? pty.title : ""
    const stored = finite(pty.titleNumber) ?? 0
    return [
      {
        id: pty.id,
        title,
        titleNumber: stored > 0 ? stored : (numberFromTitle(title) ?? 0),
        rows: finite(pty.rows),
        cols: finite(pty.cols),
        buffer: typeof pty.buffer === "string" ? pty.buffer : undefined,
        scrollY: finite(pty.scrollY),
        cursor: finite(pty.cursor),
      },
    ]
  })
  const active = "active" in value && typeof value.active === "string" ? value.active : undefined
  return { active: active && seen.has(active) ? active : all[0]?.id, all }
}

/** The lowest number not taken by a terminal's title. */
export function nextTerminalNumber(all: readonly LocalPTY[]) {
  const taken = new Set(
    all.flatMap((pty) => {
      if (Number.isFinite(pty.titleNumber) && pty.titleNumber > 0) return [pty.titleNumber]
      const parsed = numberFromTitle(pty.title)
      return parsed === undefined ? [] : [parsed]
    }),
  )
  return Array.from({ length: taken.size + 1 }, (_, index) => index + 1).find((number) => !taken.has(number)) ?? 1
}

export function addTerminal(state: TerminalState, pty: LocalPTY): TerminalState {
  return { active: pty.id, all: [...state.all, pty] }
}

/** Close a terminal: the one before it becomes active, or the next when it was first. */
export function closeTerminal(state: TerminalState, id: string): TerminalState {
  const index = state.all.findIndex((pty) => pty.id === id)
  if (index === -1) return state
  const active = state.active === id ? (index > 0 ? state.all[index - 1]?.id : state.all[1]?.id) : state.active
  return { active, all: state.all.filter((pty) => pty.id !== id) }
}

/** A PTY that exited on the server: the first remaining terminal becomes active. */
export function removeExited(state: TerminalState, id: string): TerminalState {
  const index = state.all.findIndex((pty) => pty.id === id)
  if (index === -1) return state
  const active = state.active === id ? (index === 0 ? state.all[1]?.id : state.all[0]?.id) : state.active
  return { active, all: state.all.filter((pty) => pty.id !== id) }
}

export function moveTerminal(state: TerminalState, id: string, to: number): TerminalState {
  const index = state.all.findIndex((pty) => pty.id === id)
  if (index === -1 || index === to) return state
  const all = state.all.filter((pty) => pty.id !== id)
  all.splice(to, 0, state.all[index]!)
  return { ...state, all }
}

export function cycleTerminal(state: TerminalState, offset: 1 | -1): TerminalState {
  const index = state.all.findIndex((pty) => pty.id === state.active)
  if (index === -1) return state
  const next = (index + offset + state.all.length) % state.all.length
  return { ...state, active: state.all[next]?.id }
}

export function updateTerminal(state: TerminalState, pty: Partial<LocalPTY> & { id: string }): TerminalState {
  const index = state.all.findIndex((item) => item.id === pty.id)
  if (index === -1) return state
  return { ...state, all: state.all.with(index, { ...state.all[index]!, ...pty }) }
}

/** Drop the restored screen of a terminal once it is live again. */
export function trimTerminal(pty: LocalPTY): LocalPTY {
  if (!pty.buffer && pty.cursor === undefined && pty.scrollY === undefined) return pty
  return { ...pty, buffer: undefined, cursor: undefined, scrollY: undefined }
}

/** A dead PTY replaced by a fresh one in its place, keeping its title and number. */
export function replaceTerminal(state: TerminalState, id: string, next: { id: string; title?: string }): TerminalState {
  const index = state.all.findIndex((pty) => pty.id === id)
  const pty = state.all[index]
  if (!pty) return state
  return {
    active: state.active === id ? next.id : state.active,
    all: state.all.with(index, { id: next.id, title: next.title ?? pty.title, titleNumber: pty.titleNumber }),
  }
}
