// #439/#245: «git видит файл» — вердикт берётся в момент правки, пока клон под рукой, и
// едет в склад строкой таблицы движка через ту же очередь.
import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BuffGitSeen } from "../../src/buff/gitseen"

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitseen-"))
  execFileSync("git", ["-C", dir, "init", "-q"])
  writeFileSync(join(dir, ".gitignore"), "ignored/\n")
  writeFileSync(join(dir, "tracked.js"), "1")
  execFileSync("git", ["-C", dir, "add", "-A"])
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"])
  mkdirSync(join(dir, "ignored"))
  writeFileSync(join(dir, "ignored", "x.js"), "1")
  writeFileSync(join(dir, "fresh.js"), "1")
  return dir
}

test("отслеживаемый и новый неигнорируемый файлы — видны, игнорируемый и чужой — нет", () => {
  const dir = repo()
  const verdict = BuffGitSeen.verdict(dir, [
    join(dir, "tracked.js"),
    join(dir, "fresh.js"),
    join(dir, "ignored", "x.js"),
    "/definitely/outside/of/any/repo.js",
  ])
  expect(verdict).toEqual({
    [join(dir, "tracked.js")]: true,
    [join(dir, "fresh.js")]: true,
    [join(dir, "ignored", "x.js")]: false,
    "/definitely/outside/of/any/repo.js": false,
  })
})

test("удалённый отслеживаемый файл всё ещё виден — git помнит его в индексе", () => {
  const dir = repo()
  execFileSync("rm", [join(dir, "tracked.js")])
  expect(BuffGitSeen.verdict(dir, [join(dir, "tracked.js")])).toEqual({ [join(dir, "tracked.js")]: true })
})

test("пути правок берутся из результата инструмента; не правка — ничего", () => {
  expect(BuffGitSeen.paths("edit", { metadata: { files: [{ file: "/a/b.js" }, { file: "/a/c.js" }] } })).toEqual(["/a/b.js", "/a/c.js"])
  expect(BuffGitSeen.paths("tools.write", { metadata: { files: [{ file: "/a/b.js" }] } })).toEqual(["/a/b.js"])
  // write о файле не отчитывается — путь берётся из входа; дубликат схлопывается
  expect(BuffGitSeen.paths("write", { output: {} }, { path: "/a/new.js" })).toEqual(["/a/new.js"])
  expect(BuffGitSeen.paths("edit", { metadata: { files: [{ file: "/a/b.js" }] } }, { path: "/a/b.js" })).toEqual(["/a/b.js"])
  expect(BuffGitSeen.paths("read", { metadata: { files: [{ file: "/a/b.js" }] } })).toEqual([])
  expect(BuffGitSeen.paths("edit", { metadata: {} })).toEqual([])
})
