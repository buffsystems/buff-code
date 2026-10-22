import { afterEach, expect, test } from "bun:test"
import { followColorScheme } from "./color-scheme"

afterEach(() => {
  document.documentElement.classList.remove("dark")
  delete document.documentElement.dataset.colorScheme
})

test("names the painted mode on <html> at once and follows every change", async () => {
  const root = document.documentElement
  const stop = followColorScheme(root)
  expect(root.dataset.colorScheme).toBe("light")
  root.classList.add("dark")
  await Promise.resolve()
  expect(root.dataset.colorScheme).toBe("dark")
  stop()
  root.classList.remove("dark")
  await Promise.resolve()
  expect(root.dataset.colorScheme).toBe("dark")
})
