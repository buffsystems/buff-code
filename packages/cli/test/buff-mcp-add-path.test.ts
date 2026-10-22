import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveConfigPath } from "../src/commands/handlers/mcp/add"

// #510: `buff mcp add` пишет в buffcode.json, но в проекте с opencode.json — в него.
describe("куда `buff mcp add` записывает сервер", () => {
  test("чистый каталог — buffcode.json; есть только opencode.json — он; есть оба — buffcode.json", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "buff-mcp-add-"))
    try {
      expect(await resolveConfigPath(root)).toBe(path.join(root, "buffcode.json"))
      await fs.writeFile(path.join(root, "opencode.json"), "{}")
      expect(await resolveConfigPath(root)).toBe(path.join(root, "opencode.json"))
      await fs.writeFile(path.join(root, "buffcode.json"), "{}")
      expect(await resolveConfigPath(root)).toBe(path.join(root, "buffcode.json"))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
