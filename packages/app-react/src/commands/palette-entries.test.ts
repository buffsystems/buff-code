import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import {
  commandEntry,
  matchesEntry,
  preferredCommands,
  recentFiles,
  sessionSource,
  uniqueEntries,
} from "./palette-entries"

test("the common commands come first in their order; without them, the first few", () => {
  const options = [
    { id: "a", title: "A" },
    { id: "review.toggle", title: "R" },
    { id: "session.new", title: "N" },
  ]
  expect(preferredCommands(options).map((option) => option.id)).toEqual(["session.new", "review.toggle"])
  expect(preferredCommands([{ id: "a", title: "A" }]).map((option) => option.id)).toEqual(["a"])
})

test("a query matches the title, description or category as written", () => {
  const entry = commandEntry({ id: "session.copyID", title: "Copy Session ID" }, "Commands")
  expect(matchesEntry(entry, "copy session")).toBe(true)
  expect(matchesEntry(entry, "session copy")).toBe(false)
  expect(uniqueEntries([entry, entry])).toHaveLength(1)
})

test("recent files put the active one first, without repeats", () => {
  expect(recentFiles(["a", "b", "a", "c"], "c")).toEqual(["c", "a", "b"])
})

test("sessions leave out archived ones and add the one an id names", async () => {
  const session = (id: string, archived?: number) =>
    ({
      id,
      title: id,
      location: { directory: "/p" },
      time: { created: 1, updated: 2, archived },
    }) as unknown as SessionInfo
  const source = sessionSource({
    server: "srv",
    load: async () => [session("ses_a"), session("ses_b", 1)],
    get: async (id) => session(id),
    project: () => "p",
    untitled: "New session",
    category: "Sessions",
  })
  const found = await source("ses_0123456789abcdefABCDEF", new AbortController().signal)
  expect(found.map((entry) => entry.sessionID)).toContain("ses_a")
  expect(found.map((entry) => entry.sessionID)).not.toContain("ses_b")
  expect(await source(" ", new AbortController().signal)).toEqual([])
})
