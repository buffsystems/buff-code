import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { BuffSessionMarks } from "@opencode/schema/buff-session-marks"
import { inProjects, lastMessageLabel, sessionRows } from "./rows"

const now = new Date(2026, 10, 10, 12).getTime()
const session = (id: string, patch: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  projectID: "prj_1",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: now - 1000, updated: now - 1000 },
  title: id,
  location: { directory: "/repo" },
  ...patch,
})
const marks = BuffSessionMarks.EMPTY

test("a session of the setup agent is marked and lands in the Setup section, nowhere else (#860)", () => {
  const rows = sessionRows(
    [session("ses_work", { agent: "build" }), session("ses_setup", { agent: "setup" })],
    (item) => item.id,
  )
  expect(rows.map((row) => [row.id, row.setup])).toEqual([
    ["ses_work", false],
    ["ses_setup", true],
  ])
  const sections = BuffSessionMarks.sections(rows, marks, now, "", () => false)
  expect(sections[0]?.kind).toBe("setup")
  expect(sections[0]?.items.map((row) => row.id)).toEqual(["ses_setup"])
  expect(sections.slice(1).flatMap((section) => section.items.map((row) => row.id))).toEqual(["ses_work"])
})

// #922: под сессией — только дата последнего сообщения: сегодня — время, в этом году — день и месяц.
test("the last message's date: the time today, the day this year, the full date before", () => {
  expect(lastMessageLabel(new Date(2026, 10, 10, 9, 5).getTime(), now, "ru")).toBe("09:05")
  expect(lastMessageLabel(new Date(2026, 10, 3, 9, 5).getTime(), now, "ru")).toBe("3 нояб.")
  expect(lastMessageLabel(new Date(2025, 10, 3, 9, 5).getTime(), now, "ru")).toBe("3 нояб. 2025 г.")
  expect(lastMessageLabel(new Date(2026, 10, 3, 9, 5).getTime(), now, "en")).toBe("Nov 3")
})

// #922: Recents — сессии проектов, открытых в окне; проект убран — его сессий нет. Настройка — всегда.
test("only the sessions of the window's projects stay, and the setup sessions", () => {
  const rows = sessionRows(
    [
      session("ses_open", { location: { directory: "/w/shop" } }),
      session("ses_worktree", { projectID: "prj_shop", location: { directory: "/w/shop-wt" } }),
      session("ses_closed", { projectID: "prj_blog", location: { directory: "/w/blog" } }),
      session("ses_setup", { projectID: "prj_x", agent: "setup", location: { directory: "/w/x" } }),
    ],
    (item) => item.id,
  )
  const projects = [{ worktree: "/w/shop", expanded: true, id: "prj_shop" }]
  expect(inProjects(rows, projects).map((row) => row.id)).toEqual(["ses_open", "ses_worktree", "ses_setup"])
})

test("a row's time is its last change, else its creation", () => {
  const [row] = sessionRows([session("ses_new", { time: { created: 5 } as SessionInfo["time"] })], () => "New")
  expect(row).toMatchObject({ title: "New", updated: 5, setup: false })
})
