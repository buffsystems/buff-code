// #847: new-session/slots.ts gathers every `*/draft-slot.tsx` with an eager import.meta.glob, which
// Vite hoists above the module's own imports. A draft-slot module that takes a runtime value from
// new-session/slots then runs before react/lazy-slot is evaluated — a TDZ on `lazy`, and the
// window never boots in dev mode. Draft-slot modules may take only types from new-session/slots.
import { expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const draftSlots = readdirSync(root)
  .filter((name) => statSync(join(root, name)).isDirectory())
  .map((name) => join(root, name, "draft-slot.tsx"))
  .filter((file) => {
    try {
      return statSync(file).isFile()
    } catch {
      return false
    }
  })

test("draft-slot modules import only types from new-session/slots", () => {
  expect(draftSlots.length).toBeGreaterThan(0)
  for (const file of draftSlots) {
    const source = readFileSync(file, "utf8")
    const valueImports = [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+"\.\.\/new-session\/slots"/gm)]
    expect({ file, valueImports: valueImports.map((match) => match[0]) }).toEqual({ file, valueImports: [] })
  }
})
