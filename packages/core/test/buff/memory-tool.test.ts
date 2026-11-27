// Инструмент `memory_save` (#969): агент сохраняет одну заметку в память проекта или аккаунта;
// человек видит её в списке и может убрать.
import { expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BuffMemoryNotes } from "@opencode/schema/buff-memory-notes"
import { BuffMemoryTool } from "../../src/buff/memory-tool"

const made = { id: "n9", at: "2026-11-25T10:00:00.000Z", chat: "ses_1" }

test("a note goes to the file of its scope and comes back as the record the transcript shows", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "memory-tool-"))
  const files = { account: path.join(dir, "config", "MEMORY.md"), project: path.join(dir, "shop", "MEMORY.md") }
  await writeFile(path.join(dir, "seed.md"), "")
  const saved = await BuffMemoryTool.save(files, { scope: "project", note: " Цены всегда в рублях " }, made)
  expect(saved).toEqual({ action: "saved", scope: "project", id: "n9", text: "Цены всегда в рублях" })
  expect(BuffMemoryNotes.parse(await readFile(files.project, "utf8"))).toEqual([{ ...made, text: "Цены всегда в рублях" }])
  await BuffMemoryTool.save(files, { scope: "account", note: "Отвечать по-русски" }, { ...made, id: "n10" })
  expect(BuffMemoryNotes.parse(await readFile(files.account, "utf8")).map((n) => n.id)).toEqual(["n10"])
})

test("outside a project every note is the account's; the same note twice is kept once; an empty one is refused", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "memory-tool-"))
  const files = { account: path.join(dir, "MEMORY.md") }
  expect((await BuffMemoryTool.save(files, { scope: "project", note: "Факт" }, made)).scope).toBe("account")
  const again = await BuffMemoryTool.save(files, { scope: "account", note: "факт" }, { ...made, id: "n11" })
  expect(again).toEqual({ action: "saved", scope: "account", id: "n9", text: "Факт" })
  expect(BuffMemoryNotes.parse(await readFile(files.account, "utf8"))).toHaveLength(1)
  await expect(BuffMemoryTool.save(files, { scope: "account", note: "  " }, made)).rejects.toThrow("Write the note.")
})

test("notes saved at once (parallel calls of one step) are all kept, a repeat among them once", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "memory-tool-"))
  const files = { account: path.join(dir, "MEMORY.md") }
  const notes = ["Зовут Ирина.", "Ведёт кофейню «Аллея».", "Зовут Ирина.", "Отчёты в рублях"]
  const saved = await Promise.all(
    notes.map((note, i) => BuffMemoryTool.save(files, { scope: "account", note }, { ...made, id: `p${i}` })),
  )
  const kept = BuffMemoryNotes.parse(await readFile(files.account, "utf8"))
  expect(kept.map((n) => n.text)).toEqual(["Зовут Ирина.", "Ведёт кофейню «Аллея».", "Отчёты в рублях"])
  expect(saved[2]!.id).toBe(saved[0]!.id)
})

test("the description is the template's text: what, when, and how it differs from AGENTS.md", () => {
  expect(BuffMemoryTool.description).toContain("Save one lasting fact or preference to memory")
  expect(BuffMemoryTool.description).toContain("This is not AGENTS.md")
  expect(BuffMemoryTool.description).not.toMatch(/\buser:|\bassistant:/i)
})
