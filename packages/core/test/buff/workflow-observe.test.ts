// Сценарии (#448): чтение рабочего каталога и команды — только внутри проекта, без оболочки.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { WorkflowObserve } from "../../src/buff/workflow/observe"

let root = ""
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" })
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "buff-observe-"))
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "Тест")
  mkdirSync(path.join(root, "src"))
  writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1\n// TODO: проверить\n")
  writeFileSync(path.join(root, "README.md"), "# Проект\n")
  git("add", ".")
  git("commit", "-q", "-m", "начало")
  writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2\n// TODO: проверить\n")
  writeFileSync(path.join(root, "src", "b.ts"), "export const b = 1\n")
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const observe = () => WorkflowObserve.make({ cwd: root, rg: "rg" })

describe("files", () => {
  test("glob, read, grep — workspace-relative", async () => {
    const o = observe()
    expect(await o.run("files.glob", ["src/*.ts"])).toEqual(["src/a.ts", "src/b.ts"])
    expect(await o.run("files.read", ["README.md"])).toBe("# Проект\n")
    expect(await o.run("files.grep", ["TODO", "*.ts"])).toEqual([
      { path: "src/a.ts", line: 2, text: "// TODO: проверить" },
    ])
  })
  test("outside the workspace — refused", async () => {
    await expect(observe().run("files.read", ["../etc/passwd"])).rejects.toThrow("is outside the project")
  })
})

describe("git", () => {
  test("changed files, diff, log, status", async () => {
    const o = observe()
    expect(await o.run("git.changedFiles", [])).toEqual(["src/a.ts", "src/b.ts"])
    expect(String(await o.run("git.diff", []))).toContain("+export const a = 2")
    expect(await o.run("git.log", [])).toMatchObject([{ subject: "начало", author: "Тест" }])
    expect(await o.run("git.status", [])).toEqual({
      branch: "main",
      clean: false,
      staged: [],
      unstaged: ["src/a.ts"],
      untracked: ["src/b.ts"],
    })
  })
})

describe("world.run", () => {
  test("a nonzero exit resolves; output whole", async () => {
    const o = observe()
    expect(await o.run("world.run", ["git", ["rev-parse", "--abbrev-ref", "HEAD"], {}])).toEqual({
      exitCode: 0,
      stdout: "main\n",
      stderr: "",
    })
    expect(await o.run("world.run", ["git", ["no-such-command"], {}])).toMatchObject({ exitCode: 1 })
  })
  test("a command that cannot start, or runs too long — rejects", async () => {
    await expect(observe().run("world.run", ["no-such-binary-447", [], {}])).rejects.toThrow()
    await expect(observe().run("world.run", ["sleep", ["5"], { timeoutMs: 100 }])).rejects.toThrow(
      "did not finish within",
    )
  })
})
