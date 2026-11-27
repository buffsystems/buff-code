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
    { path: "/home/u/.config/buff/MEMORY.md", scope: "user", notes: true },
    { path: "/work/app/MEMORY.md", scope: "project", notes: true },
  ])
})

test("a directory outside any project has only the user's file", () => {
  expect(BuffMemoryFiles.places({ user: "/home/u/.config/buff", root: "/work/app", directory: "/tmp/x" })).toEqual([
    { path: "/home/u/.config/buff/AGENTS.md", scope: "user" },
    { path: "/home/u/.config/buff/MEMORY.md", scope: "user", notes: true },
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

// #969: заметки памяти — второй файл, MEMORY.md: у пользователя и в корне проекта. В доме
// пользователя (чат вне проекта) заметок проекта нет: всё, что запомнено там, — память аккаунта.
test("notes: the user's file and the project root's; a chat outside projects has the account's only", () => {
  const input = { user: "/home/u/.config/buff", root: "/home/u/projects/shop", directory: "/home/u/projects/shop", home: "/home/u" }
  expect(BuffMemoryFiles.notes(BuffMemoryFiles.places(input))).toEqual({
    account: "/home/u/.config/buff/MEMORY.md",
    project: "/home/u/projects/shop/MEMORY.md",
  })
  const outside = BuffMemoryFiles.places({ ...input, root: "/home/u", directory: "/home/u" })
  expect(BuffMemoryFiles.notes(outside)).toEqual({ account: "/home/u/.config/buff/MEMORY.md" })
})

test("a notes file is shown only once it exists", () => {
  const places = BuffMemoryFiles.places({ user: "/u", root: "/p", directory: "/p" })
  expect(BuffMemoryFiles.shown(places, new Set()).map((place) => place.path)).toEqual(["/u/AGENTS.md", "/p/AGENTS.md"])
  expect(BuffMemoryFiles.shown(places, new Set(["/p/MEMORY.md"])).map((place) => place.path)).toEqual([
    "/u/AGENTS.md",
    "/p/AGENTS.md",
    "/p/MEMORY.md",
  ])
})
