import { expect, test } from "bun:test"
import { macClearance, titlebarStyle, type DesktopChrome } from "./chrome"

const chrome = (input: Partial<DesktopChrome>): DesktopChrome => ({
  mac: false,
  windows: false,
  linux: false,
  desktop: true,
  zoom: 1,
  fullscreen: false,
  ...input,
})

test("macOS keeps the traffic lights' room at their own size, and none in full screen", () => {
  expect(titlebarStyle(chrome({ mac: true, zoom: 2 }))).toEqual({ minHeight: "18px", paddingLeft: "34px" })
  expect(titlebarStyle(chrome({ mac: true, fullscreen: true }))).toEqual({ minHeight: "36px", paddingLeft: 0 })
  expect(macClearance(chrome({ mac: true, zoom: 0.5 }))).toBe(56)
})

test("Windows leaves the caption buttons the overlay's width", () => {
  const style = titlebarStyle(chrome({ windows: true, zoom: 2 }))
  expect(style?.width).toBe("env(titlebar-area-width, calc(100vw - 69px))")
  expect(style?.minHeight).toBe("env(titlebar-area-height, 44px)")
  expect(titlebarStyle(chrome({ windows: true, zoom: 0.5 }))?.minHeight).toBe("env(titlebar-area-height, 88px)")
})

test("Linux and the web have a native titlebar or none to make room for", () => {
  expect(titlebarStyle(chrome({ linux: true }))).toBeUndefined()
  expect(macClearance(chrome({ linux: true }))).toBeUndefined()
})
