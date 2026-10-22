// Встроенный git (#495): системный git старее 2.35 или его нет вовсе — снимки идут встроенным.
import { describe, expect, test } from "bun:test"
import { BuffGitBinary } from "../../src/buff/git-binary"

describe("the git version", () => {
  test("is read from every known `git --version` form", () => {
    expect(BuffGitBinary.parseVersion("git version 2.25.1\n")).toEqual([2, 25, 1])
    expect(BuffGitBinary.parseVersion("git version 2.39.5 (Apple Git-154)")).toEqual([2, 39, 5])
    expect(BuffGitBinary.parseVersion("git version 2.47.1.windows.1")).toEqual([2, 47, 1])
    expect(BuffGitBinary.parseVersion("git version 2.35")).toEqual([2, 35, 0])
    expect(BuffGitBinary.parseVersion("bash: git: command not found")).toBeUndefined()
  })

  test("snapshots need 2.35 — `git add --sparse` appeared there", () => {
    expect(BuffGitBinary.snapshotReady([2, 35, 0])).toBe(true)
    expect(BuffGitBinary.snapshotReady([3, 0, 0])).toBe(true)
    expect(BuffGitBinary.snapshotReady([2, 34, 9])).toBe(false)
    expect(BuffGitBinary.snapshotReady([2, 25, 1])).toBe(false)
  })
})

test("the bundled git lies next to the running executable", () => {
  expect(BuffGitBinary.bundledPath("/home/dev/.buff/bin/buff", "linux")).toBe(
    "/home/dev/.buff/bin/buff-git/libexec/git-core/git",
  )
  expect(BuffGitBinary.bundledPath("/Applications/Buff.app/Contents/Resources/buff", "darwin")).toBe(
    "/Applications/Buff.app/Contents/Resources/buff-git/libexec/git-core/git",
  )
  expect(BuffGitBinary.bundledPath("C:/Buff/buff.exe", "win32").replaceAll("\\", "/")).toBe(
    "C:/Buff/buff-git/cmd/git.exe",
  )
})

describe("the choice", () => {
  const modern = { path: "/usr/bin/git", version: [2, 47, 3] as const }
  const old = { path: "/usr/bin/git", version: [2, 25, 1] as const }
  const bundled = "/opt/buff/buff-git/bin/git"

  test("a suitable system git serves everything — nothing changes for it", () => {
    expect(BuffGitBinary.choose({ system: modern, bundled })).toEqual({
      repository: "/usr/bin/git",
      snapshot: "/usr/bin/git",
    })
  })

  test("an old system git keeps the user's repository, snapshots go to the bundled one", () => {
    expect(BuffGitBinary.choose({ system: old, bundled })).toEqual({ repository: "/usr/bin/git", snapshot: bundled })
  })

  test("no system git at all — the bundled one serves the repository too", () => {
    expect(BuffGitBinary.choose({ system: undefined, bundled })).toEqual({ repository: bundled, snapshot: bundled })
  })

  test("a system git whose version is unreadable is still the user's git, but not trusted with snapshots", () => {
    expect(BuffGitBinary.choose({ system: { path: "/usr/bin/git", version: undefined }, bundled })).toEqual({
      repository: "/usr/bin/git",
      snapshot: bundled,
    })
  })

  test("nothing suitable — snapshots have no git, and say why", () => {
    expect(BuffGitBinary.choose({ system: old, bundled: undefined })).toEqual({
      repository: "/usr/bin/git",
      snapshot: undefined,
      missing: { reason: "old", version: "2.25.1" },
    })
    expect(BuffGitBinary.choose({ system: { path: "/usr/bin/git", version: undefined }, bundled: undefined })).toEqual({
      repository: "/usr/bin/git",
      snapshot: undefined,
      missing: { reason: "old", version: "unknown" },
    })
    expect(BuffGitBinary.choose({ system: undefined, bundled: undefined })).toEqual({
      repository: "git",
      snapshot: undefined,
      missing: { reason: "absent" },
    })
  })

  test("the reason reads as a sentence with the required version", () => {
    expect(BuffGitBinary.missingMessage({ reason: "old", version: "2.25.1" })).toContain("2.35 or newer")
    expect(BuffGitBinary.missingMessage({ reason: "old", version: "2.25.1" })).toContain("2.25.1")
    expect(BuffGitBinary.missingMessage({ reason: "absent" })).toContain("no git was found")
  })
})

test("a repository is recognised by .git up the tree — without running git", () => {
  const present = new Set(["/home/dev/app/.git"])
  const exists = (file: string) => present.has(file)
  expect(BuffGitBinary.insideRepository("/home/dev/app/src/lib", exists)).toBe(true)
  expect(BuffGitBinary.insideRepository("/home/dev/app", exists)).toBe(true)
  expect(BuffGitBinary.insideRepository("/home/dev/other", exists)).toBe(false)
})
