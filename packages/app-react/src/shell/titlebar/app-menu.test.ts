import { expect, test } from "bun:test"
import { appMenuAccelerator } from "./app-menu"

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init)

test("the menu's Windows accelerators run its actions while it is closed", () => {
  expect(appMenuAccelerator(key({ key: "N", ctrlKey: true, shiftKey: true }))).toBe("window.new")
  expect(appMenuAccelerator(key({ key: "0", ctrlKey: true }))).toBe("view.resetZoom")
})

test("editing keys stay with the focused editor", () => {
  expect(appMenuAccelerator(key({ key: "c", ctrlKey: true }))).toBeUndefined()
  expect(appMenuAccelerator(key({ key: "z", ctrlKey: true }))).toBeUndefined()
})
