import { expect, test } from "bun:test"
import { groupOf, groupTabs, shownOrder } from "./groups"
import { tabKey, tabServer, type Tab } from "./tabs"

const server = tabServer("local")
const session = (id: string): Tab => ({ type: "session", server, sessionId: id })
const draft = (id: string, directory: string, worktree?: string): Tab =>
  ({ type: "draft", draftID: id, server, directory, ...(worktree ? { worktree } : {}) }) as Tab

const directories: Record<string, string | undefined> = { a: "/w/shop", b: "/w/blog", c: "/w/shop" }
const directoryOf = (tab: Tab) => (tab.type === "session" ? directories[tab.sessionId] : undefined)

test("tabs group by project in the order of each project's first tab; a draft joins its worktree", () => {
  const groups = groupTabs([session("a"), session("b"), session("c"), draft("d", "/w/blog", "/w/blog-wt")], directoryOf)
  expect(groups.map((group) => [group.directory, group.tabs.length])).toEqual([
    ["/w/shop", 2],
    ["/w/blog", 1],
    ["/w/blog-wt", 1],
  ])
})

test("a tab whose project is not known yet stays a plain row on top", () => {
  const groups = groupTabs([session("a"), session("x")], directoryOf)
  expect(groups.map((group) => group.directory)).toEqual([undefined, "/w/shop"])
  expect(groupOf(groups, tabKey(session("x")))?.directory).toBeUndefined()
})

test("the shown order skips folded groups but never the current tab", () => {
  const list = [session("a"), session("b"), session("c")]
  const groups = groupTabs(list, directoryOf)
  const shop = groups[0]!.key
  expect(shownOrder(groups, new Set(), undefined, () => true)).toEqual([
    tabKey(session("a")),
    tabKey(session("c")),
    tabKey(session("b")),
  ])
  expect(shownOrder(groups, new Set([shop]), tabKey(session("c")), () => true)).toEqual([
    tabKey(session("c")),
    tabKey(session("b")),
  ])
  expect(shownOrder(groups, new Set(), undefined, (tab) => tab.type === "session" && tab.sessionId !== "a")).toEqual([
    tabKey(session("c")),
    tabKey(session("b")),
  ])
})
