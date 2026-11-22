import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BuffProjectDir } from "../../src/buff/project-dir"

// #510: свой каталог — .buffcode; где уже есть только .opencode, настройки остаются там.
describe("каталог Buff Code внутри проекта или домашнего каталога", () => {
  test("чистое место — .buffcode; только .opencode — он; оба — .buffcode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "buff-project-dir-"))
    try {
      expect(BuffProjectDir.of(root)).toBe(path.join(root, ".buffcode"))
      await fs.mkdir(path.join(root, ".opencode"))
      expect(BuffProjectDir.of(root)).toBe(path.join(root, ".opencode"))
      await fs.mkdir(path.join(root, ".buffcode"))
      expect(BuffProjectDir.of(root)).toBe(path.join(root, ".buffcode"))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

// #951: личная папка проекта — в конфигурации пользователя, по идентификатору проекта.
describe("личная папка проекта", () => {
  const dirs = { config: "/home/u/.config/buffcode", home: "/home/u" }

  test("у проекта — <конфигурация>/projects/<id>", () => {
    expect(BuffProjectDir.personal(dirs, { id: "abc123", directory: "/work/repo" })).toBe(
      path.join(dirs.config, "projects", "abc123"),
    )
  })

  test("вне проекта её нет: домашняя папка, папка конфигурации, проект без идентификатора", () => {
    expect(BuffProjectDir.personal(dirs, { id: "h0me", directory: "/home/u" })).toBeUndefined()
    expect(BuffProjectDir.personal(dirs, { id: "c0nf", directory: dirs.config })).toBeUndefined()
    expect(BuffProjectDir.personal(dirs, { id: "global", directory: "/work/empty" })).toBeUndefined()
  })
})
