import { expect, test, type Locator, type Page } from "../utils/test"
import type { OpenCodeEvent, WorktreeDirectory } from "@opencode/client/promise"
import { base64Encode } from "@opencode/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionReady } from "../utils/waits"

const root = "C:/OpenCode/WorkspaceAccent"
const workspace = `${root}/.worktrees/feature`
const projectID = "proj_workspace_accent"
const sessionID = "ses_workspace_accent"
const title = "Workspace accent regression"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const inventory: WorktreeDirectory[] = [
  { directory: root },
  { directory: workspace, strategy: "git" },
  { directory: "C:/OpenCode/LinkedWorkspace", strategy: "git" },
  { directory: "C:/OpenCode/WorkspaceCopy", strategy: "copy" },
  { directory: "C:/OpenCode/RegisteredDirectory" },
]

test.use({ serviceWorkers: "block" })

// Buff (#471): the send button is flat like the cabinet's buttons — one background color instead of
// upstream's gradient — and a disabled send is grey instead of a faded contrast button.
// Buff (#584): the React window paints with @buff/ui's tokens (primary button, muted disabled, soft
// brand plate for a person's message), so each color falls back to the design system's token.
const NEUTRAL = "var(--v2-background-bg-icon-button-contrast, var(--primary))"
const DISABLED = "var(--v2-buff-hover, var(--muted-2))"
const MESSAGE = "var(--v2-state-bg-info, var(--brand-soft))"
const MESSAGE_TEXT = "var(--v2-text-text-base, var(--brand-soft-foreground))"

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((theme) => {
        localStorage.setItem("opencode-theme-id", "oc-2")
        localStorage.setItem("opencode-color-scheme", theme)
      }, theme)
    })

    for (const scenario of [
      { name: "managed Git worktree", directory: workspace, accent: true },
      { name: "linked Git worktree outside main", directory: "C:/OpenCode/LinkedWorkspace", accent: true },
      {
        name: "linked Git worktree on a narrow screen",
        directory: "C:/OpenCode/LinkedWorkspace",
        accent: true,
        viewport: { width: 390, height: 844 },
      },
      {
        name: "main root with Windows case and separators",
        directory: "c:\\OPENCODE\\workspaceaccent\\",
        accent: false,
      },
      { name: "nested main directory", directory: `${root}/packages/app`, accent: false },
      { name: "nested workspace inside main", directory: `${workspace}/packages/app`, accent: true },
      {
        name: "workspace with Windows case and separators",
        directory: "c:\\opencode\\WORKSPACEACCENT\\.worktrees\\FEATURE\\src\\",
        accent: true,
      },
      { name: "unregistered sibling with the same prefix", directory: `${workspace}-unregistered`, accent: false },
      { name: "workspace using another strategy", directory: "C:/OpenCode/WorkspaceCopy", accent: true },
      { name: "registered directory without a strategy", directory: "C:/OpenCode/RegisteredDirectory", accent: true },
    ]) {
      test(`existing session send button: ${scenario.name}`, async ({ page }, testInfo) => {
        if (scenario.viewport) await page.setViewportSize(scenario.viewport)
        const view = await openSession(page, scenario.directory)
        await view.input.fill("Inspect this fixture workspace.")
        await expect(view.send).toBeEnabled()

        if (scenario.name === "managed Git worktree") {
          // Capture before the color assertion so both red and green runs have evidence.
          const path = testInfo.outputPath("workspace-accent.png")
          await view.composer.screenshot({ path })
          await testInfo.attach("workspace-accent", { path, contentType: "image/png" })
        }

        await expectBackground(view.send, NEUTRAL)
        await view.send.hover()
        await expectBackground(view.send, NEUTRAL)
        await view.composer.locator('[data-action="composer-model"]').press("Tab")
        await expect(view.send).toBeFocused()
        await expectBackground(view.send, NEUTRAL)
        const message = page.locator('[data-slot="user-message-text"]')
        await expect(message).toHaveText("Check this fixture workspace.")
        // Buff (#471): a person's message looks the same in a workspace and in the main checkout — dark
        // text on light blue, like the cabinet's plates — so the classification is asserted directly.
        await expect(
          page.locator(scenario.accent ? "[data-workspace-session]" : "[data-local-session]").filter({ has: message }),
        ).toHaveCount(1)
        await expectToken(message, "background-color", MESSAGE)
        await expectToken(message, "color", MESSAGE_TEXT)
      })
    }

    test("a failed worktree listing is retried and the session becomes a workspace", async ({ page }) => {
      const requests: number[] = []
      page.on("response", (response) => {
        const url = new URL(response.url())
        if (url.pathname === "/api/worktree" && response.request().method() === "GET") requests.push(response.status())
      })
      // Neither an event nor a reconnect: only the retry can bring the inventory.
      await openSession(page, workspace, [...inventory], false, 1)
      const message = page.locator('[data-slot="user-message-text"]')
      await expect(message).toHaveText("Check this fixture workspace.")
      await expect(page.locator("[data-workspace-session]").filter({ has: message })).toHaveCount(1)
      await expect(page.locator("[data-local-session]").filter({ has: message })).toHaveCount(0)
      expect(requests).toEqual([500, 200])
    })

    test("inventory updates leave send neutral; disabled and stop stay neutral", async ({ page }) => {
      const view = await openSession(page, workspace, [{ directory: root }])
      await view.input.fill("Keep this draft while the inventory changes.")
      await expect(view.send).toBeEnabled()
      await expectBackground(view.send, NEUTRAL)
      const url = page.url()

      const refreshed = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/worktree" &&
          new URL(response.url()).searchParams.get("projectID") === projectID &&
          response.request().method() === "GET",
      )
      view.worktrees.push({ directory: workspace, strategy: "git" })
      view.events.push({
        id: "evt_workspace_accent_inventory",
        created: 1700000001000,
        type: "worktree.updated",
        data: { projectID },
      })
      expect((await refreshed).ok()).toBe(true)
      await expectBackground(view.send, NEUTRAL)
      await expect(page).toHaveURL(url)
      await expect(view.input).toHaveText("Keep this draft while the inventory changes.")
      await expect(view.send).toBeEnabled()

      await view.input.fill("")
      await expect(view.send).toBeDisabled()
      await expectBackground(view.send, DISABLED)

      view.events.push({
        id: "evt_workspace_accent_running",
        created: 1700000002000,
        type: "session.execution.started",
        durable: { aggregateID: sessionID, seq: 1, version: 1 },
        data: { sessionID },
      })
      const stop = view.composer.getByRole("button", { name: "Stop", exact: true })
      await expect(stop).toBeEnabled()
      await expectBackground(stop, NEUTRAL)

      await view.input.fill("Send a follow-up instead of stopping.")
      await expect(view.send).toBeEnabled()
      await expectBackground(view.send, NEUTRAL)
      await expect(page).toHaveURL(url)
    })

    test("new workspace send button stays neutral", async ({ page }) => {
      const view = await openSession(page, root, [...inventory], true)
      await expect(view.send).toBeDisabled()
      await expectBackground(view.send, DISABLED)
      await page.getByRole("button", { name: "Local", exact: true }).click()
      await page.getByRole("menuitem", { name: "New worktree", exact: true }).click()
      await expect(page.getByRole("button", { name: "New worktree", exact: true })).toBeVisible()
      await view.input.fill("Inspect this fixture workspace.")
      await expect(view.send).toBeEnabled()
      await expectBackground(view.send, NEUTRAL)
      await view.send.hover()
      await expectBackground(view.send, NEUTRAL)
      await view.composer.locator('[data-action="composer-model"]').press("Tab")
      await expect(view.send).toBeFocused()
      await expectBackground(view.send, NEUTRAL)
    })
  })
}

async function openSession(
  page: Page,
  directory: string,
  worktrees = [...inventory],
  draft = false,
  failures = 0,
) {
  const events: OpenCodeEvent[] = []
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      canonical: root,
      worktree: root,
      vcs: "git",
      name: "workspace-accent",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { "accent-model": { id: "accent-model", name: "Accent Model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "accent-model" },
    },
    sessions: [
      {
        id: sessionID,
        projectID,
        directory,
        title,
        model: { id: "accent-model", providerID: "opencode" },
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({
      items: [
        {
          id: "msg_workspace_accent",
          type: "user",
          text: "Check this fixture workspace.",
          time: { created: 1700000000000 },
        },
      ],
    }),
    events: () => events.splice(0),
  })
  // Keep authoritative inventory independent of the raw project's empty sandboxes.
  const listings = { failed: 0 }
  await page.route(
    (url) => url.pathname === "/api/worktree",
    (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      if (listings.failed < failures) {
        listings.failed++
        return route.fulfill({ status: 500, body: "", headers: { "access-control-allow-origin": "*" } })
      }
      return route.fulfill({ json: worktrees, headers: { "access-control-allow-origin": "*" } })
    },
  )
  if (draft)
    await page.addInitScript(
      ({ root, server }) => {
        localStorage.setItem(
          "opencode.global.dat:server",
          JSON.stringify({
            projects: { local: [{ worktree: root, expanded: true }] },
            lastProject: { local: root },
          }),
        )
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify([{ type: "draft", draftID: "draft_workspace_accent", server, directory: root }]),
        )
      },
      { root, server },
    )
  const loaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/worktree" &&
      new URL(response.url()).searchParams.get("projectID") === projectID &&
      response.request().method() === "GET" &&
      response.ok(),
  )
  await page.goto(
    draft ? "/new-session?draftId=draft_workspace_accent" : `/server/${base64Encode(server)}/session/${sessionID}`,
  )
  expect((await loaded).ok()).toBe(true)
  if (!draft) await expectSessionReady(page, { server, sessionID, title })
  const composer = page.locator('[data-component="composer"]')
  await expectAppVisible(composer)
  const input = composer.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(input).toBeEditable()
  await expect(composer.locator('[data-action="composer-model"]')).toHaveText("Accent Model")
  return { composer, input, send: composer.getByRole("button", { name: "Send", exact: true }), events, worktrees }
}

async function expectBackground(element: Locator, token: string, property = "background-color") {
  const color = await element.evaluate((element, token) => {
    // Resolve semantic colors through the browser.
    const probe = document.createElement("span")
    probe.hidden = true
    probe.style.backgroundColor = token
    element.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  }, token)
  await expect(element).toHaveCSS(property, new RegExp(color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
}

async function expectToken(element: Locator, property: string, token: string) {
  const color = await element.evaluate((element, token) => {
    const probe = document.createElement("span")
    probe.hidden = true
    probe.style.color = token
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
  await expect(element).toHaveCSS(property, color)
}
