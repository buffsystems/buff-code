import { beforeEach, describe, expect, test } from "bun:test"
import { BUFF_FRAME } from "@opencode/ui/theme/buff"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()
const setSystemDark = (matches: boolean) =>
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches }) as MediaQueryList,
    configurable: true,
  })

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  document.documentElement.style.removeProperty("background-color")
  localStorage.clear()
  setSystemDark(false)
})

describe("theme preload", () => {
  test("uses default theme and system light mode when settings are absent", () => {
    run()

    expect(document.documentElement.dataset.theme).toBe("oc-2")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(document.documentElement.style.backgroundColor).toBe(BUFF_FRAME.light)
  })

  test("restores explicit dark mode on a light system", () => {
    localStorage.setItem("opencode-color-scheme", "dark")
    run()

    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(document.documentElement.style.backgroundColor).toBe(BUFF_FRAME.dark)
  })

  test("restores explicit light mode on a dark system", () => {
    setSystemDark(true)
    localStorage.setItem("opencode-color-scheme", "light")
    run()

    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(document.documentElement.style.backgroundColor).toBe(BUFF_FRAME.light)
  })

  test("resolves persisted system mode before paint", () => {
    setSystemDark(true)
    localStorage.setItem("opencode-color-scheme", "system")
    run()

    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(document.documentElement.style.backgroundColor).toBe(BUFF_FRAME.dark)
  })

  // Buff (#471): тема одна — сохранённые темы апстрима и их кэш больше не применяются.
  test("ignores a persisted upstream theme and its cached css", () => {
    localStorage.setItem("opencode-theme-id", "nightowl")
    localStorage.setItem("opencode-color-scheme", "dark")
    localStorage.setItem("opencode-theme-css-dark", "--background-base:#010203;")
    run()

    expect(document.documentElement.dataset.theme).toBe("oc-2")
    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  test("paints the theme-color meta with the Buff frame", () => {
    document.head.innerHTML = '<meta name="theme-color" content="">'
    localStorage.setItem("opencode-color-scheme", "dark")
    run()

    expect(document.querySelector("meta[name='theme-color']")?.getAttribute("content")).toBe(BUFF_FRAME.dark)
  })
})
