// Заметки памяти (#969): файл MEMORY.md — список пунктов, у каждого свой номер; их пишет агент
// (`memory_save`) и правит человек. Разбор, запись и то, что из них получает модель.
import { describe, expect, test } from "bun:test"
import { BuffMemoryNotes } from "../src/buff-memory-notes.js"

const FILE = [
  "# Память",
  "",
  "- Предпочитает таблицы спискам <!-- id:n1 at:2026-11-20T10:12:00.000Z chat:ses_1 -->",
  "- Кофейня открыта с 8:00 <!-- id:n2 at:2026-11-21T08:40:00.000Z -->",
  "- Строка, дописанная руками",
  "",
].join("\n")

describe("reading", () => {
  test("every bullet is a note; one written by hand gets an id from its text and stays put", () => {
    const notes = BuffMemoryNotes.parse(FILE)
    expect(notes).toEqual([
      { id: "n1", text: "Предпочитает таблицы спискам", at: "2026-11-20T10:12:00.000Z", chat: "ses_1" },
      { id: "n2", text: "Кофейня открыта с 8:00", at: "2026-11-21T08:40:00.000Z" },
      { id: notes[2]!.id, text: "Строка, дописанная руками" },
    ])
    expect(notes[2]!.id).toMatch(/^h[0-9a-z]+$/)
    expect(BuffMemoryNotes.parse(FILE)[2]!.id).toBe(notes[2]!.id)
    expect(BuffMemoryNotes.parse("")).toEqual([])
  })
})

describe("writing", () => {
  test("a file made from notes reads back the same; text that is not a note is kept above them", () => {
    const notes = BuffMemoryNotes.parse(FILE)
    const written = BuffMemoryNotes.serialize(FILE, notes)
    expect(BuffMemoryNotes.parse(written)).toEqual(notes)
    expect(written.startsWith("# Память\n\n- Предпочитает")).toBe(true)
    expect(BuffMemoryNotes.serialize("", [])).toBe("")
  })

  test("add puts a one-line note at the end; edit and remove go by id; an unknown id changes nothing", () => {
    const made = { id: "n3", at: "2026-11-25T00:00:00.000Z", chat: "ses_9" }
    const added = BuffMemoryNotes.add(BuffMemoryNotes.parse(FILE), "  Цены\nв рублях --> всегда ", made)
    expect(added.at(-1)).toEqual({ ...made, text: "Цены в рублях → всегда" })
    const edited = BuffMemoryNotes.edit(added, "n2", "Открыта с 9:00")
    expect(edited?.find((n) => n.id === "n2")).toEqual({ id: "n2", text: "Открыта с 9:00", at: "2026-11-21T08:40:00.000Z" })
    expect(BuffMemoryNotes.remove(added, "n1")?.map((n) => n.id)).not.toContain("n1")
    expect(BuffMemoryNotes.edit(added, "nope", "x")).toBeUndefined()
    expect(BuffMemoryNotes.remove(added, "nope")).toBeUndefined()
    expect(BuffMemoryNotes.problem(" ")).toBe("Write the note.")
    expect(BuffMemoryNotes.problem("ok")).toBeUndefined()
  })
})

describe("what the model gets", () => {
  test("the notes as plain bullets, without ids; newest kept when they exceed the limit", () => {
    const notes = BuffMemoryNotes.parse(FILE)
    expect(BuffMemoryNotes.forModel(notes, 8000)).toBe(
      "- Предпочитает таблицы спискам\n- Кофейня открыта с 8:00\n- Строка, дописанная руками\n",
    )
    const cut = BuffMemoryNotes.forModel(notes, 60)
    expect(cut).toBe("- Кофейня открыта с 8:00\n- Строка, дописанная руками\n")
    expect(BuffMemoryNotes.over(notes, 60)).toBe(true)
    expect(BuffMemoryNotes.over(notes, 8000)).toBe(false)
    expect(BuffMemoryNotes.forModel([], 100)).toBe("")
  })
})
