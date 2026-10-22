import { expect, test } from "bun:test"
import { createServerState } from "./server-state"

const storage = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

test("reads the Solid window's stored projects, filling the fields it omitted", async () => {
  const state = createServerState(
    storage({
      server: JSON.stringify({ projects: { local: [{ worktree: "/repo" }] }, lastProject: { local: "/repo" } }),
    }),
  )
  await state.ready
  expect(state.projects("local").list()).toEqual([{ worktree: "/repo", expanded: true }])
  expect(state.projects("local").last()).toBe("/repo")
  expect(state.store.get().list).toEqual([])
})

test("opening, closing and reopening a project keeps the recently closed list in step", async () => {
  const backing = storage()
  const state = createServerState(backing)
  await state.ready
  const projects = state.projects("local")
  projects.open("/a")
  projects.open("/b")
  expect(projects.list().map((project) => project.worktree)).toEqual(["/b", "/a"])
  projects.close("/a")
  expect(projects.recentlyClosed()).toEqual(["/a"])
  projects.open("/a")
  expect(projects.recentlyClosed()).toEqual([])
  expect(JSON.parse(backing.items.get("server") ?? "{}").projects.local).toHaveLength(2)
})

test("a project moves to the index it was dropped at", async () => {
  const state = createServerState(storage())
  await state.ready
  const projects = state.projects("local")
  ;["/c", "/b", "/a"].forEach((directory) => projects.open(directory))
  projects.move("/a", 2)
  expect(projects.list().map((project) => project.worktree)).toEqual(["/b", "/c", "/a"])
  projects.move("/missing", 0)
  expect(projects.list().map((project) => project.worktree)).toEqual(["/b", "/c", "/a"])
})
