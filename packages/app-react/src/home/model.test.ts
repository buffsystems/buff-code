import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import {
  groupSessions,
  homeProjects,
  homeRecords,
  moveSearchKey,
  searchHomeRecords,
  toggleHomeSelection,
} from "./model"

const at = (date: Date) => date.getTime()
const now = new Date(2026, 9, 16, 12)
const session = (id: string, updated: number, patch: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  projectID: "prj_1",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: updated, updated },
  title: id,
  location: { directory: "/repo" },
  ...patch,
})
const titles = { today: "Today", yesterday: "Yesterday", older: "Older", recent: "Recent sessions" }

test("records merge the index with live sessions, newest first, without children or archived", () => {
  const records = homeRecords({
    fetched: [session("ses_a", at(new Date(2026, 9, 15))), session("ses_child", 5, { parentID: "ses_a" })],
    known: [session("ses_b", at(now)), session("ses_old", 1, { time: { created: 1, updated: 1, archived: 2 } })],
    projects: [{ worktree: "/repo", expanded: true, name: "Repo" }],
    now: at(now),
  })
  expect(records.map((record) => record.session.id)).toEqual(["ses_b", "ses_a"])
  expect(records[0]?.projectName).toBe("Repo")
})

test("a selected project narrows the records to its directories", () => {
  const records = homeRecords({
    fetched: [session("ses_a", 2), session("ses_other", 3, { location: { directory: "/other" } })],
    known: [],
    projects: [],
    directories: ["/other"],
    now: at(now),
  })
  expect(records.map((record) => record.session.id)).toEqual(["ses_other"])
})

test("groups by local day; with only older sessions the group is called recent", () => {
  const records = homeRecords({
    fetched: [session("ses_today", at(now)), session("ses_yesterday", at(new Date(2026, 9, 15, 9)))],
    known: [],
    projects: [],
    now: at(now),
  })
  expect(groupSessions(records, now, titles).map((group) => [group.title, group.sessions.length])).toEqual([
    ["Today", 1],
    ["Yesterday", 1],
  ])
  const old = homeRecords({
    fetched: [session("ses_old", at(new Date(2026, 8, 1)))],
    known: [],
    projects: [],
    now: at(now),
  })
  expect(groupSessions(old, now, titles).map((group) => group.title)).toEqual(["Recent sessions"])
})

test("open projects take the server's name by directory", () => {
  expect(
    homeProjects(
      [{ worktree: "/repo", expanded: true }],
      [{ id: "prj_1", canonical: "/repo", name: "Repo", sandboxes: [], time: { created: 1, updated: 1 } }],
    ),
  ).toEqual([{ worktree: "/repo", expanded: true, id: "prj_1", name: "Repo", sandboxes: [] }])
})

test("hidden sessions leave the list; a limit caps it", () => {
  const records = homeRecords({
    fetched: [session("ses_a", 3), session("ses_b", 2), session("ses_c", 1)],
    known: [],
    projects: [],
    hidden: new Set(["ses_b"]),
    limit: 1,
    now: at(now),
  })
  expect(records.map((record) => record.session.id)).toEqual(["ses_a"])
})

test("search matches title or project name; an exact ID lookup leads", () => {
  const records = homeRecords({
    fetched: [session("Fix login", 2), session("Other", 1)],
    known: [],
    projects: [{ worktree: "/repo", expanded: true, name: "Shop" }],
    now: at(now),
  })
  const label = (record: (typeof records)[number]) => record.session.title ?? ""
  expect(searchHomeRecords(records, " login ", label).map((record) => record.session.id)).toEqual(["Fix login"])
  expect(searchHomeRecords(records, "shop", label)).toHaveLength(2)
  expect(searchHomeRecords(records, "", label)).toEqual([])
  const exact = { ...records[1]!, session: session("ses_exact", 1) }
  expect(searchHomeRecords(records, "zzz", label, exact).map((record) => record.session.id)).toEqual(["ses_exact"])
})

test("selection toggles a project off back to the server; arrow keys wrap", () => {
  expect(toggleHomeSelection({ server: "a" }, "a", "/repo")).toEqual({ server: "a", directory: "/repo" })
  expect(toggleHomeSelection({ server: "a", directory: "/repo" }, "a", "/repo")).toEqual({ server: "a" })
  expect(moveSearchKey(["x", "y"], "y", 1)).toBe("x")
  expect(moveSearchKey(["x", "y"], "", -1)).toBe("y")
  expect(moveSearchKey([], "", 1)).toBe("")
})
