import { expect, test } from "bun:test"
import { createMemoryHistory } from "../../router/history"
import { sessionHref } from "../../router/routes"
import { memoryStorage } from "../../test/storage"
import { createTabs, tabHref, tabKey, tabServer } from "./tabs"

const server = tabServer("http://a")

function setup(path = "/", stored: Record<string, string> = {}) {
  const storage = memoryStorage(stored)
  const history = createMemoryHistory(path)
  let id = 0
  const tabs = createTabs({ storage, history, newID: () => `d${++id}` })
  return { storage, history, tabs }
}

test("adds a session tab once and persists the list as the Solid window does", () => {
  const { tabs, storage } = setup()
  tabs.addSessionTab({ server, sessionId: "s1" })
  tabs.addSessionTab({ server, sessionId: "s1" })
  expect(tabs.tabs()).toHaveLength(1)
  expect(JSON.parse(storage.items.get("tabs") ?? "[]")).toEqual([{ type: "session", server, sessionId: "s1" }])
})

test("restores stored tabs", async () => {
  const { tabs } = setup("/", {
    tabs: JSON.stringify([{ type: "session", server: "http://a", sessionId: "s1" }]),
    "tabs.recent": JSON.stringify({ key: "x" }),
  })
  await tabs.ready
  expect(tabs.tabs().map((tab) => tab.type === "session" && tab.sessionId)).toEqual(["s1"])
  expect(tabs.recentKey()).toBe("x")
})

test("closing the shown tab moves to its neighbour; closing the last goes home; reopen restores it", () => {
  const { tabs, history } = setup()
  const a = tabs.addSessionTab({ server, sessionId: "a" })
  const b = tabs.addSessionTab({ server, sessionId: "b" })
  tabs.select(a)
  tabs.closeTab(0)
  expect(history.location.get().pathname).toBe(tabHref(b))
  tabs.closeTab(0)
  expect(history.location.get().pathname).toBe("/")
  tabs.reopenClosedTab()
  expect(tabs.tabs().map(tabKey)).toEqual([tabKey(b)])
  expect(history.location.get().pathname).toBe(tabHref(b))
})

test("a draft opens at its route and is promoted to its session in place", () => {
  const { tabs, history } = setup()
  tabs.addSessionTab({ server, sessionId: "a" })
  const draft = tabs.newDraft({ server, directory: "/repo" })
  expect(history.location.get()).toEqual({ pathname: "/new-session", search: "?draftId=d1" })
  tabs.promoteDraft(draft.draftID, { server, sessionId: "s2" })
  expect(tabs.tabs().map((tab) => tab.type === "session" && tab.sessionId)).toEqual(["a", "s2"])
  expect(history.location.get().pathname).toBe(sessionHref(server, "s2"))
})

test("removing the shown session moves to the next session tab", () => {
  const { tabs, history } = setup()
  const a = tabs.addSessionTab({ server, sessionId: "a" })
  const b = tabs.addSessionTab({ server, sessionId: "b" })
  tabs.select(a)
  tabs.removeSessions(server, ["a"])
  expect(tabs.tabs().map(tabKey)).toEqual([tabKey(b)])
  expect(history.location.get().pathname).toBe(tabHref(b))
})

test("home toggles back to the last tab", () => {
  const { tabs, history } = setup()
  const a = tabs.addSessionTab({ server, sessionId: "a" })
  tabs.select(a)
  tabs.toggleHome(false, a)
  expect(history.location.get().pathname).toBe("/")
  tabs.toggleHome(true)
  expect(history.location.get().pathname).toBe(tabHref(a))
})

test("a subagent route is remembered on its root tab and cleared on return", () => {
  const { tabs } = setup()
  const a = tabs.addSessionTab({ server, sessionId: "a" })
  tabs.rememberSessionRoute(a, "child", "a")
  expect(tabs.tabs()[0]).toEqual({ ...a, routeSessionId: "child", routeParentId: "a" })
  tabs.rememberSessionRoute(a, "a")
  expect(tabs.tabs()[0]).toEqual(a)
})

test("servers leaving the window take their tabs", () => {
  const { tabs } = setup()
  tabs.addSessionTab({ server, sessionId: "a" })
  tabs.addSessionTab({ server: tabServer("http://b"), sessionId: "b" })
  tabs.retainServers(["http://b"])
  expect(tabs.tabs().map((tab) => `${tab.server}`)).toEqual(["http://b"])
})

test("a pending session takes the draft's tab at once and rolls back to the draft", async () => {
  const { tabs, history } = setup()
  const draft = tabs.newDraft({ server, directory: "/repo", worktree: "create" })
  const prepared = tabs.prepareSession(draft.draftID, { server, sessionId: "s1" }, {})
  expect(history.location.get().pathname).toBe(sessionHref(server, "s1"))
  expect(tabs.pendingSession("http://a", "s1")?.draft).toEqual(draft)
  await prepared.rollback("/repo-wt")
  expect(tabs.tabs()).toEqual([{ ...draft, worktree: "/repo-wt", branch: undefined }])
  expect(history.location.get()).toEqual({ pathname: "/new-session", search: "?draftId=d1" })
  expect(tabs.pendingSession("http://a", "s1")).toBeUndefined()
})

test("a completed pending session keeps its tab", async () => {
  const { tabs } = setup()
  const draft = tabs.newDraft({ server, directory: "/repo" })
  const prepared = tabs.prepareSession(draft.draftID, { server, sessionId: "s1" }, {})
  await prepared.complete()
  await prepared.rollback()
  expect(tabs.tabs().map(tabKey)).toEqual([tabKey({ type: "session", server, sessionId: "s1" })])
})

test("each tab keeps its panes under the Solid window's tabs.panes, and loses them when it closes", () => {
  const { tabs, storage } = setup()
  const a = tabs.addSessionTab({ server, sessionId: "a" })
  const b = tabs.addSessionTab({ server, sessionId: "b" })
  tabs.setPanes(tabKey(a), { review: true, sessionWidth: 580 })
  tabs.setPanes(tabKey(b), { terminal: true })
  tabs.setPanes(tabKey(a), { terminalHeight: 300 })
  expect(tabs.panes.get()[tabKey(a)]).toEqual({ review: true, sessionWidth: 580, terminalHeight: 300 })
  expect(JSON.parse(storage.items.get("tabs.panes") ?? "{}")[tabKey(b)]).toEqual({ terminal: true })
  tabs.closeTab(0)
  expect(Object.keys(tabs.panes.get())).toEqual([tabKey(b)])
})

test("stored panes of tabs that are gone are dropped once loaded", async () => {
  const a = { type: "session" as const, server, sessionId: "a" }
  const { tabs } = setup("/", {
    tabs: JSON.stringify([a]),
    "tabs.panes": JSON.stringify({ [tabKey(a)]: { review: true }, stale: { terminal: true } }),
  })
  await tabs.ready
  expect(tabs.panes.get()).toEqual({ [tabKey(a)]: { review: true } })
})
