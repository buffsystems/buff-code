// The persisted server list and per-server project lists (#584): the Solid app's "server" state
// (opencode.global.dat:server), decoded with the same schema so both windows read and write it.

import { pathKey } from "@opencode/app/react-reuse/path-key"
import { Persistence } from "@opencode/app/react-reuse/persistence-schema"
import { serverState } from "@opencode/app/react-reuse/server-persistence"
import { Option, Schema } from "effect"
import type { PlatformStorage } from "../platform/platform"
import { createPersisted } from "./persisted"

export type ServerStateValue = ReturnType<typeof serverState>["current"]["Type"]
export type LocalProject = ServerStateValue["projects"][string][number]

const initial: ServerStateValue = { list: [], hidden: {}, projects: {}, lastProject: {}, recentlyClosed: {} }

export function createServerState(storage: PlatformStorage, canonicalLocalServer?: string) {
  const decode = Schema.decodeUnknownOption(
    Schema.fromJsonString(
      Persistence.withInitial(
        serverState(() => canonicalLocalServer),
        initial,
      ),
    ),
  )
  const cell = createPersisted({
    storage,
    key: "server",
    decode: (raw) => Option.getOrUndefined(decode(raw)),
    initial,
  })
  return { ...cell, projects: (scope: string) => serverProjects(cell, scope) }
}

export type ServerState = ReturnType<typeof createServerState>

/** The projects one server scope has open, ported from createServerProjects. */
function serverProjects(cell: ReturnType<typeof createPersisted<ServerStateValue>>, scope: string) {
  const current = () => cell.store.get().projects[scope] ?? []
  const closed = () => cell.store.get().recentlyClosed[scope] ?? []
  const setList = (list: LocalProject[]) =>
    cell.set((state) => ({ ...state, projects: { ...state.projects, [scope]: list } }))
  const setExpanded = (directory: string, expanded: boolean) =>
    setList(current().map((project) => (project.worktree === directory ? { ...project, expanded } : project)))
  const remove = (directory: string) => setList(current().filter((project) => project.worktree !== directory))
  return {
    list: current,
    recentlyClosed: closed,
    remove,
    open(directory: string) {
      const key = pathKey(directory)
      if (closed().some((worktree) => pathKey(worktree) === key))
        cell.set((state) => ({
          ...state,
          recentlyClosed: { ...state.recentlyClosed, [scope]: closed().filter((item) => pathKey(item) !== key) },
        }))
      if (current().some((project) => project.worktree === directory)) return
      setList([{ worktree: directory, expanded: true }, ...current()])
    },
    // User-initiated close: removes the project and records it as recently closed.
    close(directory: string) {
      remove(directory)
      const key = pathKey(directory)
      cell.set((state) => ({
        ...state,
        recentlyClosed: {
          ...state.recentlyClosed,
          [scope]: [directory, ...closed().filter((item) => pathKey(item) !== key)],
        },
      }))
    },
    /** Drag reordering: the project goes to the index it was dropped at. */
    move(directory: string, index: number) {
      const list = current()
      const from = list.findIndex((project) => project.worktree === directory)
      if (from === -1 || from === index) return
      const next = list.filter((_, position) => position !== from)
      next.splice(index, 0, ...list.slice(from, from + 1))
      setList(next)
    },
    expand: (directory: string) => setExpanded(directory, true),
    collapse: (directory: string) => setExpanded(directory, false),
    last: () => cell.store.get().lastProject[scope],
    touch: (directory: string) =>
      cell.set((state) => ({ ...state, lastProject: { ...state.lastProject, [scope]: directory } })),
  }
}
