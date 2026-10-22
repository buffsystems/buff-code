// Встроенный git (#495): десктоп раскладывает консоль в профиль — и каталог buff-git рядом с ней.
import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { BuffGitStage } from "./git"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function layout(withGit: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), "buff-git-"))
  roots.push(root)
  const resources = path.join(root, "resources")
  const staged = path.join(root, "cli", "2.0.11")
  mkdirSync(staged, { recursive: true })
  mkdirSync(resources, { recursive: true })
  writeFileSync(path.join(resources, "opencode-cli"), "cli")
  if (withGit) {
    mkdirSync(path.join(resources, "buff-git", "libexec", "git-core"), { recursive: true })
    writeFileSync(path.join(resources, "buff-git", "libexec", "git-core", "git"), "git")
    chmodSync(path.join(resources, "buff-git", "libexec", "git-core", "git"), 0o755)
  }
  return { cli: path.join(resources, "opencode-cli"), staged }
}

describe("staging the bundled git next to the staged CLI", () => {
  test("the whole directory is copied, executables stay executable", async () => {
    const { cli, staged } = layout(true)
    await BuffGitStage.stage(cli, staged)
    const git = path.join(staged, "buff-git", "libexec", "git-core", "git")
    expect(readFileSync(git, "utf8")).toBe("git")
    expect(statSync(git).mode & 0o111).toBeTruthy()
    expect(existsSync(`${path.join(staged, "buff-git")}.${process.pid}.tmp`)).toBe(false)
  })
  test("an existing copy is kept", async () => {
    const { cli, staged } = layout(true)
    mkdirSync(path.join(staged, "buff-git"))
    writeFileSync(path.join(staged, "buff-git", "kept"), "kept")
    await BuffGitStage.stage(cli, staged)
    expect(existsSync(path.join(staged, "buff-git", "libexec"))).toBe(false)
  })
  test("a build without git (macOS) — nothing to stage, no error", async () => {
    const { cli, staged } = layout(false)
    await BuffGitStage.stage(cli, staged)
    expect(existsSync(path.join(staged, "buff-git"))).toBe(false)
  })
})
