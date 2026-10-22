import { expect, test } from "bun:test"
import { memoryStorage } from "../test/storage"
import { createCommandCatalog } from "./catalog"
import { createCommandRegistry } from "./registry"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("visible commands are recorded with their default keybinds", async () => {
  const storage = memoryStorage()
  const registry = createCommandRegistry({ keybindOverride: (id) => (id === "session.new" ? "ctrl+x" : undefined) })
  const catalog = createCommandCatalog(storage, registry)
  const stop = catalog.start()
  registry.register("screen", () => [{ id: "session.new", title: "New session", keybind: "mod+shift+s" }])
  await tick()
  expect(catalog.store.get()).toEqual({ "session.new": { title: "New session", keybind: "mod+shift+s" } })
  expect(JSON.parse(storage.items.get("command.catalog.v1") ?? "{}")["session.new"].title).toBe("New session")
  stop()
})

// The Solid window's writesCatalog (#470, #584): «New session» on Ctrl+T is hidden from the palette
// but its keys stay editable in settings.
test("a hidden command enters the catalog when new and never renames a known one", async () => {
  const registry = createCommandRegistry({ keybindOverride: () => undefined })
  const catalog = createCommandCatalog(memoryStorage(), registry)
  const stop = catalog.start()
  registry.register("shell", () => [{ id: "tab.new", title: "New session", keybind: "mod+t", hidden: true }])
  registry.register("screen", () => [{ id: "settings.open", title: "Settings", keybind: "mod+comma" }])
  await tick()
  registry.register("settings", () => [{ id: "settings.open", title: "Close settings", hidden: true }])
  await tick()
  expect(catalog.store.get()).toEqual({
    "tab.new": { title: "New session", keybind: "mod+t" },
    "settings.open": { title: "Settings", keybind: "mod+comma" },
  })
  stop()
})
