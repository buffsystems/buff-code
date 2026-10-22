import { describe, expect, test } from "bun:test"
import { BuffLinks } from "@opencode/schema/buff-links"
import { DESKTOP_MENU } from "./desktop-menu"

describe("desktop menu", () => {
  test("installs the CLI from the macOS application menu", () => {
    const appMenu = DESKTOP_MENU.find((menu) => menu.id === "app")
    const item = appMenu?.items?.find((entry) => entry.type === "item" && entry.action === "app.installCli")

    expect(item).toEqual({ type: "item", labelKey: "desktop.menu.installCli", action: "app.installCli" })
  })

  test("exports logs through the desktop command registry", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.labelKey === "desktop.menu.exportLogs",
    )

    expect(items).toHaveLength(2)
    expect(items.every((item) => item.type === "item" && item.command === "logs.export" && !item.action)).toBe(true)
  })

  // Buff (#462): помощь ведёт на наши адреса; форума апстрима в меню нет.
  test("help points at our documentation and support", () => {
    const help = DESKTOP_MENU.find((menu) => menu.id === "help")
    const links = (help?.items ?? []).flatMap((item) => (item.type === "item" && item.href ? [item] : []))

    expect(links.map((item) => item.labelKey)).toEqual([
      "desktop.menu.documentation",
      "desktop.menu.shareFeedback",
      "desktop.menu.reportBug",
    ])
    expect(links[0].href).toBe(BuffLinks.docs)
    expect(links.slice(1).every((item) => item.href?.startsWith(`${BuffLinks.support}?subject=`))).toBe(true)
  })

  test("provides translated labels for role-backed entries", () => {
    const windowMenu = DESKTOP_MENU.find((menu) => menu.role === "windowMenu")
    const roleItems = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.role && item.labelKey,
    )

    expect(windowMenu?.labelKey).toBe("desktop.menu.window")
    expect(roleItems.length).toBeGreaterThan(0)
  })
})
