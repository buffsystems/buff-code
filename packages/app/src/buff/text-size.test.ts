// Размер шрифта (#461): границы, множитель интерфейса, размер кода — и что попадает в стили.
import { beforeEach, expect, test } from "bun:test"
import { BuffTextSize } from "./text-size"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("style")
})

// #471: основной текст апстрима — 13 px; по умолчанию он 14 px, как в кабинете Buff.
test("by default the main text is 14 px, like the cabinet; code keeps its size", () => {
  BuffTextSize.apply()
  expect(BuffTextSize.ui()).toBe(14)
  expect(BuffTextSize.code()).toBe(13)
  expect(document.documentElement.style.getPropertyValue("--buff-ui-scale")).toBe(String(14 / 13))
  expect(document.documentElement.style.getPropertyValue("--buff-code-font-size")).toBe("")
})

test("the interface size is the size of the main text; code — its own size", () => {
  BuffTextSize.setUi(17.5)
  BuffTextSize.setCode(16)
  expect(document.documentElement.style.getPropertyValue("--buff-ui-scale")).toBe(String(18 / 13))
  expect(document.documentElement.style.getPropertyValue("--buff-code-font-size")).toBe("16px")
  expect(BuffTextSize.terminal()).toBe(16)
})

test("sizes stay within the bounds and survive a restart", () => {
  BuffTextSize.setUi(99)
  BuffTextSize.setCode(1)
  expect(BuffTextSize.ui()).toBe(20)
  expect(BuffTextSize.code()).toBe(10)
  BuffTextSize.reload()
  expect(BuffTextSize.ui()).toBe(20)
})

test("reset returns the defaults", () => {
  BuffTextSize.setUi(18)
  BuffTextSize.reset()
  expect(BuffTextSize.ui()).toBe(14)
  expect(BuffTextSize.terminal()).toBe(14)
  expect(document.documentElement.style.getPropertyValue("--buff-ui-scale")).toBe(String(14 / 13))
})
