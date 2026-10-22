import { expect, test } from "bun:test"
import { createCommandRegistry, PALETTE_ID } from "./registry"

const press = (init: KeyboardEventInit, target?: HTMLElement) => {
  const event = new KeyboardEvent("keydown", { cancelable: true, ...init })
  if (target) Object.defineProperty(event, "target", { value: target })
  return event
}

test("a newer registration under the same key replaces the older; unregister restores it", () => {
  const registry = createCommandRegistry({})
  registry.register("screen", () => [{ id: "a", title: "Old" }])
  const stop = registry.register("screen", () => [{ id: "a", title: "New" }])
  expect(registry.palette().map((option) => option.title)).toEqual(["New"])
  stop()
  expect(registry.palette().map((option) => option.title)).toEqual(["Old"])
})

test("a keybind runs its command; the palette keybind opens the palette", () => {
  const registry = createCommandRegistry({})
  const ran: string[] = []
  registry.register(undefined, () => [
    {
      id: "settings.open",
      title: "Open settings",
      keybind: "ctrl+comma",
      onSelect: (source) => ran.push(`settings:${source}`),
    },
    { id: PALETTE_ID, title: "Palette", hidden: true, onSelect: (source) => ran.push(`palette:${source}`) },
  ])
  const event = press({ key: ",", ctrlKey: true })
  registry.handleKeyDown(event)
  registry.handleKeyDown(press({ key: "P", ctrlKey: true, shiftKey: true }))
  expect(ran).toEqual(["settings:keybind", "palette:palette"])
  expect(event.defaultPrevented).toBe(true)
})

test("plain keys typed into a field stay with the field", () => {
  const registry = createCommandRegistry({})
  const ran: string[] = []
  registry.register(undefined, () => [{ id: "x", title: "X", keybind: "x", onSelect: () => ran.push("x") }])
  registry.handleKeyDown(press({ key: "x" }, document.createElement("input")))
  registry.handleKeyDown(press({ key: "x" }))
  expect(ran).toEqual(["x"])
})

test("suspended or blocked keybinds do nothing; overrides replace the default keybind", () => {
  const blocked = { value: false }
  const registry = createCommandRegistry({
    blocked: () => blocked.value,
    keybindOverride: (id) => (id === "x" ? "y" : undefined),
  })
  const ran: string[] = []
  registry.register(undefined, () => [{ id: "x", title: "X", keybind: "x", onSelect: () => ran.push("x") }])
  registry.handleKeyDown(press({ key: "x" }))
  const resume = registry.suspend()
  registry.handleKeyDown(press({ key: "y" }))
  resume()
  blocked.value = true
  registry.handleKeyDown(press({ key: "y" }))
  blocked.value = false
  registry.handleKeyDown(press({ key: "y" }))
  expect(ran).toEqual(["x"])
  expect(registry.keybind("x")).toBe("y")
})

test("suggested commands appear first in their category and are not doubled in the palette", () => {
  const registry = createCommandRegistry({ suggestedCategory: () => "Suggested" })
  registry.register(undefined, () => [{ id: "a", title: "A", suggested: true }])
  expect(registry.options().map((option) => [option.id, option.category])).toEqual([
    ["suggested.a", "Suggested"],
    ["a", undefined],
  ])
  expect(registry.palette().map((option) => option.id)).toEqual(["a"])
})
