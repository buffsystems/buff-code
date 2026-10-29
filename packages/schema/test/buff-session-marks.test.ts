// Отметки сессий (#452): закрепление, архив, группы — и как из них складывается список.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffSessionMarks as Marks } from "../src/buff-session-marks.js"

const day = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 2, 12, 0, 0)
const session = (id: string, updated: number, title = id) => ({ id, title, updated })

describe("changing the marks", () => {
  test("pin and unpin", () => {
    const pinned = Marks.apply(Marks.EMPTY, { type: "pin", sessionID: "a", on: true })
    expect(pinned.pinned).toEqual(["a"])
    expect(Marks.apply(pinned, { type: "pin", sessionID: "a", on: true }).pinned).toEqual(["a"])
    expect(Marks.apply(pinned, { type: "pin", sessionID: "a", on: false }).pinned).toEqual([])
  })

  test("archiving takes a session off the pins — an archived session is out of sight", () => {
    const pinned = Marks.apply(Marks.EMPTY, { type: "pin", sessionID: "a", on: true })
    const archived = Marks.apply(pinned, { type: "archive", sessionID: "a", on: true })
    expect(archived).toMatchObject({ pinned: [], archived: ["a"] })
    expect(Marks.apply(archived, { type: "archive", sessionID: "a", on: false }).archived).toEqual([])
  })

  test("a group is made, renamed, recoloured, filled and removed — its sessions stay", () => {
    const made = Marks.apply(Marks.EMPTY, { type: "group.save", group: { id: "g1", name: "Выпуск", color: "blue" } })
    const filled = Marks.apply(made, { type: "group.assign", sessionID: "a", groupID: "g1" })
    expect(filled.membership).toEqual({ a: "g1" })
    const renamed = Marks.apply(filled, { type: "group.save", group: { id: "g1", name: "Выпуск 2", color: "green" } })
    expect(renamed.groups).toEqual([{ id: "g1", name: "Выпуск 2", color: "green" }])
    expect(Marks.apply(renamed, { type: "group.assign", sessionID: "a" }).membership).toEqual({})
    expect(Marks.apply(renamed, { type: "group.remove", groupID: "g1" })).toMatchObject({ groups: [], membership: {} })
  })

  test("a group needs a name; an unknown group takes no sessions", () => {
    expect(Marks.problem({ type: "group.save", group: { id: "g", name: " ", color: "blue" } }, Marks.EMPTY)).toBe(
      "Name the group.",
    )
    expect(Marks.problem({ type: "group.assign", sessionID: "a", groupID: "нет" }, Marks.EMPTY)).toBe("No such group.")
    expect(Marks.problem({ type: "pin", sessionID: "a", on: true }, Marks.EMPTY)).toBeUndefined()
  })
})

describe("the list", () => {
  const sessions = [
    session("today", now - 1000),
    session("yesterday", now - day),
    session("old", now - 5 * day),
    session("pinned", now - 9 * day),
    session("grouped", now - 2 * day),
    session("gone", now - 3 * day),
  ]
  const marks: Marks.State = {
    pinned: ["pinned"],
    archived: ["gone"],
    groups: [{ id: "g1", name: "Выпуск", color: "blue" }],
    membership: { grouped: "g1" },
  }
  const shape = (sections: Marks.Section<{ id: string }>[]) =>
    sections.map((section) => [section.title, section.items.map((item) => item.id)])

  test("pinned first, then groups, then by time; archived are out", () => {
    expect(shape(Marks.sections(sessions, marks, now))).toEqual([
      ["Pinned", ["pinned"]],
      ["Выпуск", ["grouped"]],
      ["Today", ["today"]],
      ["Yesterday", ["yesterday"]],
      ["Earlier", ["old"]],
    ])
  })

  // #709: вне закреплённых и групп — по проектам, свежий проект выше; заголовок — имя папки.
  test("by project instead of by time when the window asks", () => {
    const where: Record<string, string> = {
      today: "/w/shop",
      yesterday: "/w/blog",
      old: "/w/shop",
      grouped: "/w/blog",
      pinned: "/w/shop",
    }
    const projectOf = (item: { id: string }) => where[item.id] ?? ""
    const sections = Marks.sections(sessions, marks, now, "", projectOf)
    expect(shape(sections)).toEqual([
      ["Pinned", ["pinned"]],
      ["Выпуск", ["grouped"]],
      ["shop", ["today", "old"]],
      ["blog", ["yesterday"]],
    ])
    expect(sections.slice(2).map((section) => [section.kind, section.key])).toEqual([
      ["project", "project:/w/shop"],
      ["project", "project:/w/blog"],
    ])
  })

  test("a pinned session of a group shows among the pinned only", () => {
    const both = { ...marks, pinned: ["pinned", "grouped"] }
    expect(shape(Marks.sections(sessions, both, now)).slice(0, 2)).toEqual([
      ["Pinned", ["pinned", "grouped"]],
      ["Выпуск", []],
    ])
  })

  test("the archive is its own list, newest first", () => {
    expect(Marks.archive(sessions, marks).map((item) => item.id)).toEqual(["gone"])
  })

  // #470, как в ZCode: побочный диалог живёт во вкладке своей сессии — в списках его нет, даже в архиве.
  test("a side conversation is in no list — not even the archive", () => {
    const withSide = [...sessions, session("side", now - 500)]
    const sides: Marks.State = { ...marks, archived: ["gone", "side"], sides: ["side"] }
    const ids = Marks.sections(withSide, sides, now).flatMap((section) => section.items.map((item) => item.id))
    expect(ids).not.toContain("side")
    expect(Marks.archive(withSide, sides).map((item) => item.id)).toEqual(["gone"])
    expect(Marks.hidden(sides)).toEqual(new Set(["gone", "side"]))
    expect(Marks.isSide(sides, "side")).toBe(true)
    expect(Marks.isSide(marks, "side")).toBe(false)
  })

  test("a search looks through titles and keeps the sections", () => {
    expect(shape(Marks.sections(sessions, marks, now, "PIN"))).toEqual([["Pinned", ["pinned"]]])
  })
})

describe("the state of a session — in a word", () => {
  test("what needs the person comes first", () => {
    expect(Marks.status({ permission: true, running: true })).toEqual({
      kind: "permission",
      label: "Waiting for permission",
    })
    expect(Marks.status({ question: true })).toEqual({ kind: "question", label: "Waiting for an answer" })
    expect(Marks.status({ running: true, unread: true })).toEqual({ kind: "running", label: "Running" })
    expect(Marks.status({ failed: true, unread: true })).toEqual({ kind: "failed", label: "Error" })
    expect(Marks.status({ unread: true })).toEqual({ kind: "unread", label: "Unread" })
    expect(Marks.status({})).toBeUndefined()
  })
})

// #472: подписи схемы — английские исходные строки, и у каждой есть русский перевод.
test("every label and message has a Russian translation", () => {
  const kinds = ["permission", "question", "running", "failed", "unread"] as const
  const labels = kinds.map((kind) => Marks.status({ [kind]: true })!.label)
  const titles = ["Today", "Yesterday", "Earlier", "Pinned"]
  const problems = [
    Marks.problem({ type: "group.save", group: { id: "g", name: " ", color: "blue" } }, Marks.EMPTY)!,
    Marks.problem({ type: "group.assign", sessionID: "a", groupID: "missing" }, Marks.EMPTY)!,
  ]
  for (const text of [...labels, ...titles, ...problems]) expect(BuffI18n.t("ru", text)).not.toBe(text)
})
