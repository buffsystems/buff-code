import { expect, test } from "bun:test"
import { DESKTOP_MENU } from "@opencode/app/desktop-menu"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The desktop menus (the macOS application menu, the Windows titlebar menu) run their items through
// the window's command registry: an item whose id no React command registers does nothing.

const root = join(import.meta.dir, "..")

function registeredCommandIds() {
  const files = [...new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: root })].filter((file) => !/\.test\.tsx?$/.test(file))
  return new Set(
    files.flatMap((file) =>
      [...readFileSync(join(root, file), "utf8").matchAll(/\bid: "([\w.]+)"/g)].flatMap((match) => match[1] ?? []),
    ),
  )
}

const menuCommands = [
  ...new Set(DESKTOP_MENU.flatMap((menu) => menu.items ?? []).flatMap((item) => (item.type === "item" && item.command) || [])),
]

test("every command of the desktop menus is registered by the React window", () => {
  const registered = registeredCommandIds()
  expect(menuCommands.length).toBeGreaterThan(0)
  expect(menuCommands.filter((id) => !registered.has(id))).toEqual([])
})

test("the beta channel's update check, sent to the window as a command, is registered too", () => {
  expect(registeredCommandIds().has("app.checkForUpdates")).toBe(true)
})
