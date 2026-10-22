import { afterEach, expect, test } from "bun:test"
import { watchAppliedTheme, type AppliedTheme } from "./theme-report"

afterEach(() => {
  document.documentElement.classList.remove("dark")
  localStorage.clear()
})

test("reports the painted mode at once and on every change of <html>'s class", async () => {
  localStorage.setItem("theme", "dark")
  const seen: AppliedTheme["mode"][] = []
  const stop = watchAppliedTheme((theme) => seen.push(theme.mode))
  document.documentElement.classList.add("dark")
  await Promise.resolve()
  stop()
  document.documentElement.classList.remove("dark")
  await Promise.resolve()
  expect(seen).toEqual(["light", "dark"])
})

test("names the stored choice as the scheme", () => {
  localStorage.setItem("theme", "system")
  const seen: AppliedTheme[] = []
  watchAppliedTheme((theme) => seen.push(theme))()
  expect(seen[0]?.scheme).toBe("system")
})
