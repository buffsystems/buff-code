// What the command palette lists (#584), the Solid window's palette entries as plain TS: commands,
// files of the shown session's workspace and sessions of the server, with the rules for the
// preferred commands, matching and de-duplication.

import { looksLikeSessionID } from "@opencode/app/react-reuse/session-id-search"
import type { SessionInfo } from "@opencode/client/promise"
import type { CommandOption } from "./registry"

export type PaletteEntry = {
  id: string
  type: "command" | "file" | "session"
  title: string
  description?: string
  keybind?: string
  category: string
  option?: CommandOption
  path?: string
  directory?: string
  sessionID?: string
  server?: string
  updated?: number
}

/** A source of remote results for a query; results of an older query are dropped. */
export type PaletteSource = (query: string, signal: AbortSignal) => Promise<PaletteEntry[]>

const ENTRY_LIMIT = 5
const COMMON_COMMAND_IDS = [
  "session.new",
  "workspace.new",
  "session.previous",
  "session.next",
  "terminal.toggle",
  "review.toggle",
]

export const commandEntry = (option: CommandOption, category: string): PaletteEntry => ({
  id: "command:" + option.id,
  type: "command",
  title: option.title,
  description: option.description,
  keybind: option.keybind,
  category,
  option,
})

export const fileEntry = (path: string, category: string): PaletteEntry => ({
  id: "file:" + path,
  type: "file",
  title: path,
  category,
  path,
})

export function matchesEntry(entry: PaletteEntry, query: string) {
  const value = query.toLowerCase()
  return [entry.title, entry.description, entry.category].some((text) => text?.toLowerCase().includes(value))
}

export function uniqueEntries(entries: PaletteEntry[]) {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
}

/** With no query: the common commands in their order, or the first few when none is there. */
export function preferredCommands(options: CommandOption[]) {
  const order = new Map(COMMON_COMMAND_IDS.map((id, index) => [id, index]))
  const picked = options.filter((option) => order.has(option.id))
  if (picked.length === 0) return options.slice(0, ENTRY_LIMIT)
  return [...picked].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

/** The most recent file tabs, the active one first, without repeats. */
export function recentFiles(paths: string[], active?: string) {
  const order = active ? [active, ...paths.filter((path) => path !== active)] : paths
  return [...new Set(order)].slice(0, ENTRY_LIMIT)
}

/**
 * Sessions of a server matching a query: the server's search, and the session itself when the
 * query looks like an id. Archived sessions are left out.
 */
export function sessionSource(input: {
  server: string
  load: (search: string, signal: AbortSignal) => Promise<SessionInfo[]>
  get: (sessionID: string, signal: AbortSignal) => Promise<SessionInfo>
  project: (session: SessionInfo) => string
  untitled: string
  category: string
}): PaletteSource {
  return async (query, signal) => {
    const search = query.trim()
    if (!search) return []
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 100)
      signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true })
    })
    if (signal.aborted) return []
    const [listed, exact] = await Promise.all([
      input.load(search, signal).catch(() => []),
      looksLikeSessionID(search)
        ? input.get(search, signal).then(
            (session) => [session],
            () => [],
          )
        : [],
    ])
    return [...new Map([...exact, ...listed].map((session) => [session.id, session] as const)).values()]
      .filter((session) => !session.time.archived)
      .map((session) => ({
        id: `session:${input.server}:${session.id}`,
        type: "session" as const,
        title: session.title || input.untitled,
        description: input.project(session),
        category: input.category,
        directory: session.location.directory,
        sessionID: session.id,
        server: input.server,
        updated: session.time.updated,
      }))
  }
}
