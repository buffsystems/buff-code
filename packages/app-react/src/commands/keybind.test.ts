import { expect, test } from "bun:test"
import { formatKeybind, matchKeybind, parseKeybind, signature, signatureFromEvent } from "./keybind"

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init)
const t = (label: string) =>
  ({ "common.key.ctrl": "Ctrl", "common.key.shift": "Shift", "common.key.enter": "Enter" })[label] ?? label

test("mod is Ctrl off macOS and ⌘ on it; commas separate alternatives", () => {
  expect(parseKeybind("mod+k,mod+shift+p", false)).toEqual([
    { key: "k", ctrl: true, meta: false, shift: false, alt: false },
    { key: "p", ctrl: true, meta: false, shift: true, alt: false },
  ])
  expect(parseKeybind("mod+k", true)[0]).toMatchObject({ meta: true, ctrl: false })
  expect(parseKeybind("none")).toEqual([])
})

test("an event matches only the exact modifier set", () => {
  const keybinds = parseKeybind("mod+shift+p", false)
  expect(matchKeybind(keybinds, key({ key: "P", ctrlKey: true, shiftKey: true }))).toBe(true)
  expect(matchKeybind(keybinds, key({ key: "p", ctrlKey: true }))).toBe(false)
  expect(signatureFromEvent(key({ key: "P", ctrlKey: true, shiftKey: true }))).toBe(signature(keybinds[0]!))
})

test("Alt+letter matches by physical key", () => {
  expect(matchKeybind(parseKeybind("alt+n", false), key({ key: "˜", code: "KeyN", altKey: true }))).toBe(true)
})

test("labels use glyphs on macOS and translated names elsewhere", () => {
  expect(formatKeybind("mod+shift+enter", t, false)).toBe("Ctrl+Shift+Enter")
  expect(formatKeybind("mod+shift+p", t, true)).toBe("⇧⌘P")
  expect(formatKeybind("mod+comma", t, true)).toBe("⌘,")
})
