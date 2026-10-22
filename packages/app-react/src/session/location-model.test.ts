import { expect, test } from "bun:test"
import { isWorkspaceSession } from "./location-model"

const root = "C:/OpenCode/WorkspaceAccent"
const workspace = `${root}/.worktrees/feature`
const worktrees = [
  { directory: root },
  { directory: workspace, strategy: "git" as const },
  { directory: "C:/OpenCode/RegisteredDirectory" },
]

test("a directory inside a listed worktree other than the project's root is a workspace", () => {
  expect(isWorkspaceSession({ canonical: root, sandboxes: [], worktrees, directory: workspace })).toBe(true)
  expect(
    isWorkspaceSession({ canonical: root, sandboxes: [], worktrees, directory: `${workspace}/packages/app` }),
  ).toBe(true)
  expect(
    isWorkspaceSession({ canonical: root, sandboxes: [], worktrees, directory: "C:/OpenCode/RegisteredDirectory" }),
  ).toBe(true)
})

test("the project's root, a folder in it and an unlisted sibling are local", () => {
  expect(isWorkspaceSession({ canonical: root, sandboxes: [], worktrees, directory: "c:\\OPENCODE\\workspaceaccent\\" })).toBe(
    false,
  )
  expect(isWorkspaceSession({ canonical: root, sandboxes: [], worktrees, directory: `${root}/packages/app` })).toBe(false)
  expect(isWorkspaceSession({ canonical: root, sandboxes: [], worktrees, directory: `${workspace}-unregistered` })).toBe(
    false,
  )
})

test("without a loaded inventory the project's own sandboxes decide", () => {
  expect(isWorkspaceSession({ canonical: root, sandboxes: [workspace], directory: workspace })).toBe(true)
  expect(isWorkspaceSession({ canonical: root, sandboxes: [], directory: workspace })).toBe(false)
})

test("an unknown project is local", () => {
  expect(isWorkspaceSession({ directory: workspace })).toBe(false)
})
