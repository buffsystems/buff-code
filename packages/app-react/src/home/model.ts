// What Home shows (#584): the Solid Home's session index merged with live sessions, its records
// and day groups. The index and merge logic is reused from the Solid app. Records and grouping are
// ported: the Solid records module types its projects with the Solid layout store, and the
// grouping lives in its Solid controller.

import {
  HOME_SESSION_LIMIT,
  mergeHomeSessionIndex,
  retainHomeSessions,
} from "@opencode/app/react-reuse/home-session-index"
import { pathKey } from "@opencode/app/react-reuse/path-key"
import type { Project, SessionInfo } from "@opencode/client/promise"
import { getFilename } from "@opencode/util/path"
import type { LocalProject } from "../core/server-state"

export type HomeProject = LocalProject & { id?: string; name?: string; sandboxes?: readonly string[] }
export type HomeSessionRecord = { session: SessionInfo; project: HomeProject; projectName: string }
export type HomeSessionGroup = { id: "today" | "yesterday" | "older"; title: string; sessions: HomeSessionRecord[] }

/** Open projects with the server's name for each, matched by directory. */
export function homeProjects(local: LocalProject[], known: Project[]): HomeProject[] {
  return local.map((project) => {
    const info = known.find((item) => item.canonical === project.worktree)
    return info ? { ...project, id: info.id, name: info.name, sandboxes: info.sandboxes } : project
  })
}

export function homeRecords(input: {
  fetched: SessionInfo[]
  known: SessionInfo[]
  projects: HomeProject[]
  directories?: string[]
  /** Sessions Home does not show: archived or side conversations (Buff marks), or just deleted. */
  hidden?: ReadonlySet<string>
  now: number
  /** Search reads every retained record; the list shows the first HOME_SESSION_LIMIT. */
  limit?: number
}) {
  const hidden = input.hidden
  const merged = mergeHomeSessionIndex(input.fetched, input.known).filter((session) => !hidden?.has(session.id))
  const sessions = retainHomeSessions(merged, HOME_SESSION_LIMIT, input.now)
  const directories = input.directories ? new Set(input.directories.map(pathKey)) : undefined
  const visible = directories
    ? sessions.filter((session) => directories.has(pathKey(session.location.directory)))
    : sessions
  return [...new Map(visible.map((session) => [session.id, session] as const)).values()]
    .sort(compareSessionTime)
    .slice(0, input.limit ?? HOME_SESSION_LIMIT)
    .map((session): HomeSessionRecord => {
      const project = homeProjectForSession(session, input.projects) ?? {
        id: session.projectID,
        worktree: session.location.directory,
        expanded: false,
      }
      return { session, project, projectName: displayName(project) }
    })
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree) || project.worktree

function compareSessionTime(a: SessionInfo, b: SessionInfo) {
  const updated = (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)
  if (updated !== 0) return updated
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Worktree inventories load on demand, so a worktree session may not match any directory yet; the
// session's project ID still identifies its added project.
function homeProjectForSession(session: SessionInfo, projects: readonly HomeProject[]) {
  const directory = pathKey(session.location.directory)
  return (
    projects.find(
      (item) =>
        pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
    ) ?? projects.find((item) => item.id === session.projectID)
  )
}

export function groupSessions(
  records: HomeSessionRecord[],
  now: Date,
  titles: { today: string; yesterday: string; older: string; recent: string },
): HomeSessionGroup[] {
  const today = localDay(now)
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const day = (record: HomeSessionRecord) =>
    localDay(new Date(record.session.time.updated ?? record.session.time.created))
  const todaySessions = records.filter((record) => day(record) === today)
  const yesterdaySessions = records.filter((record) => day(record) === yesterday)
  const olderSessions = records.filter((record) => day(record) !== today && day(record) !== yesterday)
  const groups: HomeSessionGroup[] = [
    { id: "today", title: titles.today, sessions: todaySessions },
    { id: "yesterday", title: titles.yesterday, sessions: yesterdaySessions },
    {
      id: "older",
      title: todaySessions.length === 0 && yesterdaySessions.length === 0 ? titles.recent : titles.older,
      sessions: olderSessions,
    },
  ]
  return groups.filter((group) => group.sessions.length > 0)
}

function localDay(date: Date) {
  return date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate()
}

/** A search row's identity: the same session can be listed once per directory. */
export const homeSearchKey = (record: HomeSessionRecord) =>
  `${pathKey(record.session.location.directory)}:${record.session.id}`

/** Records whose title or project name contain the query, case-insensitively; the exact ID match first. */
export function searchHomeRecords(
  records: readonly HomeSessionRecord[],
  query: string,
  label: (record: HomeSessionRecord) => string,
  exact?: HomeSessionRecord,
) {
  const value = query.trim().toLowerCase()
  if (!value) return []
  const found = records.filter((record) => `${label(record)} ${record.projectName}`.toLowerCase().includes(value))
  if (!exact || found.some((record) => record.session.id === exact.session.id)) return found
  return [exact, ...found]
}

export type HomeSelection = { server?: string; directory?: string }

/** Selecting the selected project again goes back to all of the server's projects. */
export function toggleHomeSelection(current: HomeSelection, server: string, directory: string): HomeSelection {
  if (current.server === server && current.directory === directory) return { server }
  return { server, directory }
}

/** The step through search results the arrow keys take, wrapping around. */
export function moveSearchKey(keys: readonly string[], active: string, delta: number) {
  if (keys.length === 0) return ""
  const index = keys.indexOf(active)
  return keys[((index === -1 ? 0 : index) + delta + keys.length) % keys.length] ?? ""
}
