import { expect, test } from "bun:test"
import { createMemoryHistory } from "../router/history"
import { sessionHref } from "../router/routes"
import { createTabs, tabServer } from "../shell/tabs/tabs"
import { memoryStorage } from "../test/storage"
import { startDraftSession, type DraftStartDeps } from "./start"

const server = tabServer("http://a")

function setup(worktree: string, overrides: Partial<DraftStartDeps> = {}) {
  const history = createMemoryHistory("/")
  const tabs = createTabs({ storage: memoryStorage(), history, newID: () => "d1" })
  const draft = tabs.newDraft({ server, directory: "/repo", worktree })
  const events: string[] = []
  const deps: DraftStartDeps = {
    tabs,
    draft,
    projectDirectory: "/repo",
    worktree,
    branch: "main",
    createWorktree: async (directory, branch) => {
      events.push(`worktree ${directory} ${branch}`)
      return "/repo-wt"
    },
    mcp: {
      capture: () => ({ docs: true }),
      prepare: async (directory) => {
        events.push(`mcp ${directory}`)
        return true
      },
      remember: (directory) => events.push(`remember-mcp ${directory}`),
    },
    refreshProjects: async () => undefined,
    remember: (value) => events.push(`last ${value}`),
    onWorktreeFailed: () => events.push("worktree-failed"),
    onCreateFailed: () => events.push("create-failed"),
    ...overrides,
  }
  return { tabs, history, deps, events }
}

test("a local draft creates the session in the project and becomes its tab", async () => {
  const { tabs, history, deps, events } = setup("main")
  const started = await startDraftSession(deps, {
    sessionID: "s1",
    create: async (directory) => void events.push(`create ${directory}`),
  })
  expect(started).toEqual({ sessionID: "s1", directory: "/repo", complete: undefined })
  expect(events).toEqual(["mcp /repo", "create /repo", "last main"])
  expect(tabs.tabs()).toEqual([{ type: "session", server, sessionId: "s1" }])
  expect(history.location.get().pathname).toBe(sessionHref(server, "s1"))
})

test("a new worktree shows the pending session first, then creates it in the worktree", async () => {
  const { tabs, history, deps, events } = setup("create")
  const started = await startDraftSession(deps, {
    sessionID: "s1",
    create: async (directory) => {
      expect(history.location.get().pathname).toBe(sessionHref(server, "s1"))
      events.push(`create ${directory}`)
    },
  })
  expect(events).toEqual(["worktree /repo main", "mcp /repo-wt", "create /repo-wt", "last create"])
  expect(started?.directory).toBe("/repo-wt")
  expect(tabs.pendingSession("http://a", "s1")).toBeDefined()
  await started?.complete?.()
  expect(tabs.pendingSession("http://a", "s1")).toBeUndefined()
})

test("a failed worktree returns to the draft untouched", async () => {
  const { tabs, history, deps, events } = setup("create", {
    createWorktree: () => Promise.reject(new Error("no")),
  })
  const started = await startDraftSession(deps, { sessionID: "s1", create: async () => undefined })
  expect(started).toBeUndefined()
  expect(events).toEqual(["worktree-failed"])
  expect(tabs.tabs()[0]).toMatchObject({ type: "draft", worktree: "create" })
  expect(history.location.get().search).toBe("?draftId=d1")
})

test("a failed session after a created worktree restores the draft on that worktree", async () => {
  const { tabs, deps, events } = setup("create")
  const started = await startDraftSession(deps, {
    sessionID: "s1",
    create: () => Promise.reject(new Error("down")),
  })
  expect(started).toBeUndefined()
  expect(events.at(-1)).toBe("create-failed")
  expect(tabs.tabs()[0]).toMatchObject({ type: "draft", worktree: "/repo-wt" })
})

test("MCP that cannot be prepared keeps the local draft", async () => {
  const { tabs, deps } = setup("main", {
    mcp: { capture: () => ({}), prepare: async () => false, remember: () => undefined },
  })
  const created: string[] = []
  expect(await startDraftSession(deps, { sessionID: "s1", create: async (d) => void created.push(d) })).toBeUndefined()
  expect(created).toEqual([])
  expect(tabs.tabs()[0]?.type).toBe("draft")
})
