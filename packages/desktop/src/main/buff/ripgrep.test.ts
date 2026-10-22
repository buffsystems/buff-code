// ripgrep сборки (#443): десктоп раскладывает консоль в профиль — и ripgrep рядом с ней.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { BuffRipgrepStage } from "./ripgrep"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function layout(withRipgrep: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), "buff-rg-"))
  roots.push(root)
  const resources = path.join(root, "resources")
  const staged = path.join(root, "cli", "2.0.11")
  mkdirSync(resources, { recursive: true })
  mkdirSync(staged, { recursive: true })
  writeFileSync(path.join(resources, "opencode-cli"), "cli")
  if (withRipgrep) writeFileSync(path.join(resources, BuffRipgrepStage.name("linux")), "rg")
  return { cli: path.join(resources, "opencode-cli"), staged }
}

describe("staging the bundled ripgrep next to the staged CLI", () => {
  test("copied, executable", async () => {
    const { cli, staged } = layout(true)
    await BuffRipgrepStage.stage(cli, staged, "linux")
    const target = path.join(staged, "buff-rg")
    expect(readFileSync(target, "utf8")).toBe("rg")
    expect(statSync(target).mode & 0o111).toBeTruthy()
  })
  test("an older staged CLI without it gets it too; an existing copy is kept", async () => {
    const { cli, staged } = layout(true)
    writeFileSync(path.join(staged, "buff-rg"), "kept")
    await BuffRipgrepStage.stage(cli, staged, "linux")
    expect(readFileSync(path.join(staged, "buff-rg"), "utf8")).toBe("kept")
  })
  test("a build without ripgrep — nothing to stage, no error", async () => {
    const { cli, staged } = layout(false)
    await BuffRipgrepStage.stage(cli, staged, "linux")
    expect(existsSync(path.join(staged, "buff-rg"))).toBe(false)
  })
  test("Windows name", () => {
    expect(BuffRipgrepStage.name("win32")).toBe("buff-rg.exe")
  })
})
