import { expect, test } from "../utils/test"
import { setupTimeline } from "../performance/timeline-stability/fixture"

// A composer that arrives after the transcript takes its height from the timeline: the rows jump
// under a reader, and under a finger that is already dragging them. Hold a separately loaded
// composer back; no frame may show the transcript without it.
test("the transcript never shows before the composer", async ({ page }) => {
  await page.route(/session-composer-[^/]*\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await route.continue()
  })
  await page.addInitScript(() => {
    const frames: string[] = []
    Object.assign(window, { transcriptWithoutComposer: frames })
    const sample = () => {
      const content = document.querySelector<HTMLElement>("[data-timeline-virtual-content]")
      const shown = !!content && content.offsetHeight > 0 && getComputedStyle(content).visibility !== "hidden"
      if (shown && !document.querySelector('[role="textbox"][aria-label="Prompt"]'))
        frames.push(performance.now().toFixed(0))
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await setupTimeline(page)
  await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible()
  const frames = await page.evaluate(
    () => (window as unknown as { transcriptWithoutComposer: string[] }).transcriptWithoutComposer,
  )
  expect(frames).toEqual([])
})
