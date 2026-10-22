import { benchmark, expect } from "../benchmark"
import { expectSessionTitle } from "../../utils/waits"
import { measureNavigationMilestones } from "./navigation-milestones"
import { fixture } from "./session-timeline-stress.fixture"
import {
  createReviewDiffs,
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressServer,
  stressSessionHref,
} from "./timeline-test-helpers"
import { waitForStableTimeline } from "./session-tab-switch-probe"

const homeRow = '[data-component="home-session-row"]'
const homeShell = '[data-component="home-session-search"]'
const reviewSelector = '#review-panel [data-component="session-review-v2"]'

benchmark.describe("performance: home and tab navigation", () => {
  benchmark("opens a home session and paints its titlebar tab", async ({ page, report }) => {
    await setup(page, [])
    await page.goto("/")
    const row = page.locator(homeRow).filter({ hasText: fixture.expected.targetTitle }).first()
    await expect(row).toBeVisible()
    const href = stressSessionHref(fixture.targetID)
    const result = await measureNavigationMilestones(page, {
      triggerSelector: homeRow,
      milestones: {
        content: { selector: messageSelector(fixture.expected.targetMessageIDs.at(-1)!) },
        tab: { selector: `[data-slot="titlebar-tabs"] a[href="${href}"]` },
      },
      navigate: async () => {
        await row.click()
        await expectSessionTitle(page, fixture.expected.targetTitle)
      },
    })
    report(result)
    await expect(page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`)).toContainText(
      fixture.expected.targetTitle,
    )
  })

  // Buff (#584): the legacy layout's always-open review (`session-review`) and its body staged after
  // the transcript were removed upstream (#42993). The review pane is now per tab and closed by
  // default, and its body is held back for the session's first frame (`deferRender` /
  // `panelRendered`) so opening a session paints the session before the review. The bench opens the
  // destination tab's review pane with changes to show and checks that order: the session's own
  // frame (its title) paints without the review body, which follows.
  benchmark("stages the review body after the session's first frame", async ({ page, report }) => {
    await mockStressTimeline(page, { vcsDiff: createReviewDiffs() })
    await installTimelineSettings(page)
    // The tab exists (unvisited, so its session loads cold) because the panes state is kept per tab.
    await installStressSessionTabs(page, { sessionIDs: [fixture.targetID] })
    await page.addInitScript(
      (tabKey) =>
        localStorage.setItem("opencode.window.browser.dat:tabs.panes", JSON.stringify({ [tabKey]: { review: true } })),
      `${stressServer()}\n${stressSessionHref(fixture.targetID)}`,
    )
    await page.goto("/")
    const row = page.locator(homeRow).filter({ hasText: fixture.expected.targetTitle }).first()
    await expect(row).toBeVisible()
    const result = await page.evaluate(
      ({ rowSelector, title, reviewSelector }) =>
        new Promise<{ sessionBeforeReview: boolean; sessionFrame: number; reviewFrame: number }>((resolve) => {
          const seen = { frame: 0, session: 0 }
          const sample = () => {
            seen.frame++
            const session = [...document.querySelectorAll("[data-session-title]")].some((element) =>
              element.textContent?.includes(title),
            )
            const review = !!document.querySelector(reviewSelector)
            if (session && !seen.session) seen.session = seen.frame
            if (review) {
              resolve({
                sessionBeforeReview: seen.session > 0 && seen.session < seen.frame,
                sessionFrame: seen.session,
                reviewFrame: seen.frame,
              })
              return
            }
            requestAnimationFrame(sample)
          }
          const target = [...document.querySelectorAll<HTMLElement>(rowSelector)].find((item) =>
            item.textContent?.includes(title),
          )
          if (!target) throw new Error(`Home session row not found: ${title}`)
          target.click()
          requestAnimationFrame(sample)
        }),
      { rowSelector: homeRow, title: fixture.expected.targetTitle, reviewSelector },
    )
    report(result)
    expect(result.sessionBeforeReview).toBe(true)
    await expect(page.locator(reviewSelector)).toBeVisible()
  })

  benchmark("closes the only session tab and paints home", async ({ page, report }) => {
    await setup(page, [fixture.sourceID])
    const href = stressSessionHref(fixture.sourceID)
    await page.goto(href)
    await expectSessionTitle(page, fixture.expected.sourceTitle)
    await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
    const tab = page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`).first()
    const close = tab.locator("..").locator('[data-component="icon-button-v2"]')
    await expect(close).toBeVisible()
    const result = await measureNavigationMilestones(page, {
      triggerSelector: '[data-slot="titlebar-tabs"] [data-component="icon-button-v2"]',
      milestones: {
        home: { selector: homeShell },
        row: { selector: homeRow },
        tabRemoved: { selector: `[data-slot="titlebar-tabs"] a[href="${href}"]`, visible: false },
      },
      navigate: async () => {
        await close.click()
        await expect(page).toHaveURL("/")
      },
    })
    report(result)
  })
})

async function setup(page: Parameters<typeof mockStressTimeline>[0], sessionIDs: string[]) {
  await mockStressTimeline(page)
  await installTimelineSettings(page)
  await installStressSessionTabs(page, { sessionIDs })
}

function messageSelector(id: string) {
  return `[data-message-id="${id}"]`
}
