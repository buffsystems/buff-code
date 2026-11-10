import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { BuffSessionMarks } from "@opencode/schema/buff-session-marks"
import { sessionRows } from "./rows"

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
  const sections = BuffSessionMarks.sections(rows, marks, now, "", (row) => row.session.location.directory)
  expect(sections[0]?.kind).toBe("setup")
  expect(sections[0]?.items.map((row) => row.id)).toEqual(["ses_setup"])
  expect(sections.slice(1).flatMap((section) => section.items.map((row) => row.id))).toEqual(["ses_work"])
})

test("a row's time is its last change, else its creation", () => {
  const [row] = sessionRows([session("ses_new", { time: { created: 5 } as SessionInfo["time"] })], () => "New")
  expect(row).toMatchObject({ title: "New", updated: 5, setup: false })
})
