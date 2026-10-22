// Файлы памяти для настроек (#446): где они лежат для данного каталога.
import { expect, test } from "bun:test"
import { BuffMemoryFiles } from "../../src/buff/memory-files.js"

test("the user's file, then the project's — from its root down to the open directory", () => {
  expect(
    BuffMemoryFiles.places({ user: "/home/u/.config/buff", root: "/work/app", directory: "/work/app/packages/web" }),
  ).toEqual([
    { path: "/home/u/.config/buff/AGENTS.md", scope: "user" },
    { path: "/work/app/AGENTS.md", scope: "project" },
    { path: "/work/app/packages/AGENTS.md", scope: "project" },
    { path: "/work/app/packages/web/AGENTS.md", scope: "project" },
  ])
})

test("a directory outside any project has only the user's file", () => {
  expect(BuffMemoryFiles.places({ user: "/home/u/.config/buff", root: "/work/app", directory: "/tmp/x" })).toEqual([
    { path: "/home/u/.config/buff/AGENTS.md", scope: "user" },
  ])
})

test("what is shown: every file that exists, and the two places one writes to first", () => {
  const places = BuffMemoryFiles.places({ user: "/u", root: "/p", directory: "/p/a/b" })
  expect(BuffMemoryFiles.shown(places, new Set(["/p/a/b/AGENTS.md"])).map((place) => place.path)).toEqual([
    "/u/AGENTS.md",
    "/p/AGENTS.md",
    "/p/a/b/AGENTS.md",
  ])
})
