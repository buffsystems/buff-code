import { expect, test } from "../utils/test"
import { fixture, pageMessages } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { BuffFeatures } from "@opencode/schema/buff-features"
import { mockOpenCodeServer } from "../utils/mock-server"

for (const direction of ["ltr", "rtl"] as const) {
  test(`session header groups controls and exposes session details in ${direction}`, async ({ page }) => {
    await mockOpenCodeServer(page, {
      directory: fixture.directory,
      project: fixture.project,
      sessions: fixture.sessions,
      provider: fixture.provider,
      pageMessages,
    })
    await installStressSessionTabs(page)
    await page.addInitScript(() => {
      const settings = JSON.parse(localStorage.getItem("settings.v3") ?? "{}")
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ ...settings, general: { ...settings.general, showStatus: true } }),
      )
    })
    await page.goto(stressSessionHref(fixture.targetID))
    const header = page.locator("[data-session-title]")
    const more = header.getByRole("button", { name: "More options", exact: true })
    const project = header.getByRole("button", { name: fixture.project.name, exact: true })
    const review = page.getByRole("button", { name: "Toggle review", exact: true })
    const details = header.getByRole("button", { name: "Session details", exact: true })
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)
    await page.evaluate((direction) => document.documentElement.setAttribute("dir", direction), direction)
    await expect(review).toBeVisible()
    await expect(details).toBeVisible()
    const status = page.locator('[data-slot="titlebar-v2"]').getByRole("button", { name: "Status" })
    await expect(status).toHaveCount(0)
    const titleBounds = await header.getByRole("heading").boundingBox()
    expect(titleBounds).not.toBeNull()
    for (const editing of [false, true]) {
      if (editing) {
        await header.getByRole("heading").click()
        await expect(header.getByRole("textbox")).toHaveValue(fixture.expected.targetTitle)
        await expect(header.getByRole("textbox")).toBeFocused()
      }
      await expect(header.locator('[data-slot="session-title-child"]')).toHaveCSS("padding-left", "4px")
      await expect(header.locator('[data-slot="session-title-child"]')).toHaveCSS("padding-right", "4px")
      await expect
        .poll(async () => {
          const boxes = await Promise.all(
            [project, header.locator('[data-slot="session-title-child"]'), more, review, details].map((control) =>
              control.boundingBox(),
            ),
          )
          const [icon, title, menu, sidebar, summary] = boxes
          if (!icon || !title || !menu || !sidebar || !summary || !titleBounds) return false
          if (Math.abs(title.y - titleBounds.y) > 0.5 || Math.abs(title.height - titleBounds.height) > 0.5) return false
          return direction === "ltr"
            ? Math.abs(title.x - icon.x - icon.width - 2) <= 0.5 &&
                Math.abs(menu.x - title.x - title.width - 2) <= 0.5 &&
                menu.x + menu.width <= summary.x &&
                summary.x + summary.width <= sidebar.x
            : Math.abs(icon.x - title.x - title.width - 2) <= 0.5 &&
                Math.abs(title.x - menu.x - menu.width - 2) <= 0.5 &&
                sidebar.x + sidebar.width <= summary.x &&
                summary.x + summary.width <= menu.x
        })
        .toBe(true)
    }
    await header.getByRole("textbox").press("Escape")
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)

    await review.click()
    await expect(review).toHaveAttribute("aria-expanded", "true")
    await expect(page.locator("#review-panel")).toBeVisible()
    await review.click()
    await expect(review).toHaveAttribute("aria-expanded", "false")

    await more.click()
    const options = page.getByRole("menu")
    // Buff (#468): session export is switched off by the owner's decision, behind one flag.
    await expect(options.getByRole("menuitem")).toHaveText(
      BuffFeatures.sessionTransfer ? ["Rename", "Export…", "Delete…"] : ["Rename", "Delete…"],
    )
    if (direction === "ltr") {
      await expect
        .poll(async () => {
          const [button, menu] = await Promise.all([
            header.getByRole("button", { name: "More options", exact: true, includeHidden: true }).boundingBox(),
            options.boundingBox(),
          ])
          return button && menu ? Math.abs(button.x - menu.x) : Infinity
        })
        .toBeLessThanOrEqual(1)
    }
    // Buff (#471, #584): the menu's own insets are the design system's (the Solid window's cabinet
    // menu and @buff/ui's differ by a pixel), so its geometry is checked by relation, not by value.
    await expect
      .poll(() =>
        options.evaluate((element) => {
          const menu = element.getBoundingClientRect()
          const rtl = getComputedStyle(element).direction === "rtl"
          const rows = Array.from(element.querySelectorAll('[role="menuitem"]'), (row) => row.getBoundingClientRect())
          const divider = element.querySelector('[data-slot="menu-v2-separator"]')?.getBoundingClientRect()
          const labels = Array.from(element.querySelectorAll('[data-slot="menu-v2-item-content"]'), (label) => {
            const range = document.createRange()
            range.selectNodeContents(label)
            const text = range.getBoundingClientRect()
            return {
              lead: rtl ? menu.right - text.right : text.left - menu.left,
              trail: rtl ? text.left - menu.left : menu.right - text.right,
            }
          })
          const inset = rows[0] ? rows[0].left - menu.left : NaN
          const near = (a: number, b: number) => Math.abs(a - b) <= 0.5
          return {
            // Every row is inset equally from both edges of the menu.
            rows:
              rows.length > 0 &&
              rows.every((row) => near(row.left - menu.left, inset) && near(menu.right - row.right, inset)),
            // The divider spans the content: centred, and at least as wide as the rows.
            divider:
              !!divider &&
              near(divider.left - menu.left, menu.right - divider.right) &&
              divider.left - menu.left <= inset + 0.5,
            // The menu holds its longest label with at least the row's leading room after it.
            width:
              labels.length > 0 &&
              Math.min(...labels.map((label) => label.trail - label.lead)) >= -0.5 &&
              labels.every((label) => label.trail > inset),
          }
        }),
      )
      .toEqual({ rows: true, divider: true, width: true })
    await expect(page.getByRole("menuitem", { name: "Server status", exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await details.click()
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    const mcp = summary.getByRole("button", { name: "MCP", exact: true })
    await expect(mcp).toBeVisible()
    await expect(summary.getByRole("button", { name: "Plugins", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(mcp).toBeHidden()
  })
}
