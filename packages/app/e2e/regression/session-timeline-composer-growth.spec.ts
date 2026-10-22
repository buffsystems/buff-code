import { devices, expect, test } from "../utils/test"
import { assistantMessage, setupTimeline, textPart, userMessage } from "../performance/timeline-stability/fixture"

// Buff (#584): a transcript that follows its end stays there when the composer under it grows, as
// the Solid timeline's dock observer keeps it. The React window lost a few rows to a composer that
// grew after the cold mount (a flake of mobile-timeline-scroll «… owns pending touch adjustments»).
for (const device of ["Desktop Chrome", "Pixel 7"] as const) {
  test(`keeps the latest message in view when the composer grows on ${device}`, async ({ browser }) => {
    const descriptor = devices[device]
    const context = await browser.newContext({ ...descriptor, viewport: descriptor.viewport })
    const page = await context.newPage()
    await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([
          textPart("prt_growth_reading", Array.from({ length: 60 }, (_, index) => `Reading ${index}.`).join("\n\n")),
        ]),
      ],
      viewport: descriptor.viewport,
    })
    const last = page.getByText("Reading 59.", { exact: true })
    await expect(last).toBeInViewport()
    const editor = page.locator('[data-component="composer-editor"]')
    await editor.click()
    for (let line = 0; line < 6; line++) await page.keyboard.press("Shift+Enter")
    await expect.poll(() => editor.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(80)
    await expect(last).toBeInViewport({ ratio: 1 })
    await context.close()
  })
}
