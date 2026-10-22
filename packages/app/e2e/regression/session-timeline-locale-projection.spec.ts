import { expect, test } from "../utils/test"
import { assistantMessage, setupTimeline, toolPart, userMessage } from "../performance/timeline-stability/fixture"

// Buff (#469) offers English and Russian only; the Russian dictionary (#472) covers every tool name,
// so the projection is checked fully localized.
for (const locale of ["ru"] as const) {
  test(`projects localized tool names in ${locale}`, async ({ page }) => {
    const ids = [`prt_locale_${locale}_01_read`, `prt_locale_${locale}_02_glob`]
    await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([
          toolPart(ids[0]!, "read", "completed", { path: "src/a.ts" }),
          toolPart(ids[1]!, "glob", "completed", { path: ".", pattern: "**/*.ts" }),
        ]),
      ],
      locale,
    })

    const group = page.locator(`[data-timeline-part-ids="${ids.join(",")}"]`)
    const names = "Чтение, Поиск файлов"
    await expect(group.getByRole("button")).toHaveAccessibleName(`Использовано 2 — ${names}`)
    await expect(group.locator('[data-slot="basic-tool-tool-title"]')).toHaveText(names)
    await expect(page.locator("html")).toHaveAttribute("lang", locale)
  })
}
