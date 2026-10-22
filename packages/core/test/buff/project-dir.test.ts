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
