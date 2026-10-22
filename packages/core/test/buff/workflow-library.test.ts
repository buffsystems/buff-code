// Сценарии (#448): сохранённые у пользователя — <имя>.dwf.ts; битые файлы названы, не спрятаны.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { WorkflowLibrary } from "../../src/buff/workflow/library"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
const library = () => {
  const root = mkdtempSync(path.join(tmpdir(), "buff-workflows-"))
  roots.push(root)
  return { root, lib: WorkflowLibrary.make(root) }
}
const meta = {
  name: "review",
  description: "Проверить ветку",
  args: { base: { type: "string" as const, default: "main" } },
}
const script = 'phase("Шаг")\nreturn await agent("a").ask("x " + args.base)\n'

describe("saved workflows", () => {
  test("saved, listed, read back", async () => {
    const { root, lib } = library()
    expect(await lib.save(meta, script, { overwrite: false })).toEqual({
      path: path.join(root, "review.dwf.ts"),
      created: true,
    })
    const listed = await lib.list()
    expect(listed.saved.map((item) => item.meta.name)).toEqual(["review"])
    expect(await lib.read("review")).toMatchObject({ meta, script })
  })
  test("a script that does not compile is not written; the reasons come back", async () => {
    const { lib } = library()
    const result = await lib.save(meta, 'await agent("a").ask(1)', { overwrite: false })
    expect("diagnostics" in result ? (result.diagnostics?.length ?? 0) : 0).toBeGreaterThan(0)
    expect((await lib.list()).saved).toEqual([])
  })
  test("an existing name is not overwritten unless asked", async () => {
    const { lib } = library()
    await lib.save(meta, script, { overwrite: false })
    expect(await lib.save(meta, script, { overwrite: false })).toEqual({
      problem: "Workflow «review» already exists: overwrite?",
    })
    expect(await lib.save(meta, script, { overwrite: true })).toMatchObject({ created: false })
  })
  test("metadata changes keep the script body as is", async () => {
    const { lib } = library()
    await lib.save(meta, script, { overwrite: false })
    expect(await lib.saveMeta("review", { ...meta, description: "Новое описание" })).toEqual({})
    const read = await lib.read("review")
    expect(read && "meta" in read && read.meta.description).toBe("Новое описание")
    expect(read && "script" in read && read.script).toBe(script)
  })
  test("broken files are named with the reason", async () => {
    const { root, lib } = library()
    writeFileSync(path.join(root, "broken.dwf.ts"), "const x = 1")
    expect((await lib.list()).invalid).toEqual([
      {
        path: path.join(root, "broken.dwf.ts"),
        problem: "No /* buff-workflow … */ metadata block at the start of the file.",
      },
    ])
  })
  test("removed; a bad name is refused", async () => {
    const { lib } = library()
    await lib.save(meta, script, { overwrite: false })
    expect(await lib.remove("review")).toBe(true)
    expect(await lib.remove("review")).toBe(false)
    expect(await lib.save({ ...meta, name: "../evil" }, script, { overwrite: false })).toEqual({
      problem: "A name is Latin letters, digits, dot, dash and underscore.",
    })
  })
})
