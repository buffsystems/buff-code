// Buff (#640): pairing a phone from Settings → Phone, and a session started on a phone saying so.
// The service's answers are the mock's (`buff.mobile/*` in utils/mock-buff.ts).
import { expect, test } from "../utils/test"
import { fixture, pageMessages } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({ viewport: { width: 1280, height: 900 } })

test("Settings → Phone pairs a phone: the check code is confirmed here", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    sessions: [],
    provider: fixture.provider,
    pageMessages: () => ({ items: [] }),
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Phone", exact: true }).click()

  await expect(settings.getByRole("heading", { name: "Pair a phone" })).toBeVisible()
  await expect(settings.getByRole("cell", { name: "Pixel 8", exact: true })).toBeVisible()
  await settings.getByText("Link and code", { exact: true }).click()
  await expect(settings.getByRole("textbox", { name: /^Link/ })).toHaveValue("https://buff.systems/pair/e2e")
  await expect(settings.getByLabel("ABCDEFGH", { exact: true })).toBeVisible()

  // The phone typed the code: the service now reports its check code.
  await page.route("**/api/rpc/buff.mobile/view", (route) =>
    route.fulfill({
      json: {
        output: {
          offerId: "offer-code",
          state: "sas",
          kind: "code",
          link: "https://buff.systems/pair/e2e",
          code: "ABCD-EFGH",
          expiresAt: Math.floor(Date.now() / 1000) + 300,
          phone: "Pixel 8",
          sas: "123456",
        },
      },
    }),
  )
  await expect(settings.getByText("Compare the code with the phone")).toBeVisible()
  await expect(settings.getByText("123 456")).toBeVisible()
  await settings.getByRole("button", { name: "It matches", exact: true }).click()
  await expect(settings.getByText("Phone paired")).toBeVisible()
})

test("a session started on a phone says so under its title and in the list", async ({ page }) => {
  const sessions = fixture.sessions.map((session) =>
    session.id === fixture.targetID ? { ...session, metadata: { origin: "phone", device: "Pixel 8" } } : session,
  )
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    sessions,
    provider: fixture.provider,
    pageMessages,
  })
  await installStressSessionTabs(page)
  // The sessions column shows with the tabs on the side.
  await page.addInitScript(() =>
    localStorage.setItem("settings.v3", JSON.stringify({ appearance: { tabLayout: "vertical" } })),
  )
  await page.goto(stressSessionHref(fixture.targetID))
  const header = page.locator("[data-session-title]")
  await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)
  await expect(header.getByText("Session started from the phone “Pixel 8”")).toBeVisible()
  const row = page.locator(`[data-component="buff-sessions-row"][data-session="${fixture.targetID}"]`)
  await expect(row.locator('[data-origin="phone"]')).toHaveText(/Pixel 8/)
  const other = page.locator(`[data-component="buff-sessions-row"][data-session="${fixture.sourceID}"]`)
  await expect(other).toBeVisible()
  await expect(other.locator('[data-origin="phone"]')).toHaveCount(0)
})
