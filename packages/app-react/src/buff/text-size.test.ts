import { beforeEach, expect, test } from "bun:test"
import {
  applyTextSize,
  codeSize,
  reloadTextSize,
  resetTextSize,
  setCodeSize,
  setUiSize,
  terminalSize,
  textSize,
} from "./text-size"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("style")
  reloadTextSize()
})

test("the default sizes write nothing on the page", () => {
  applyTextSize()
  expect(textSize.get().ui).toBe(14)
  expect(codeSize(textSize.get())).toBe(13)
  expect(document.documentElement.style.getPropertyValue("zoom")).toBe("")
  expect(document.documentElement.style.getPropertyValue("--buff-code-font-size")).toBe("")
})

test("a bigger interface zooms the window; code gets its own size", () => {
  setUiSize(17.5)
  setCodeSize(16)
  expect(document.documentElement.style.getPropertyValue("zoom")).toBe(String(18 / 14))
  expect(document.documentElement.style.getPropertyValue("--buff-code-font-size")).toBe("16px")
  expect(terminalSize(textSize.get())).toBe(16)
})

test("sizes stay in bounds, survive a reload and reset", () => {
  setUiSize(99)
  setCodeSize(1)
  reloadTextSize()
  expect(textSize.get()).toEqual({ ui: 20, code: 10 })
  resetTextSize()
  expect(terminalSize(textSize.get())).toBe(14)
})
