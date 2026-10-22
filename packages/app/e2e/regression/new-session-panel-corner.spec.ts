import { expect, test } from "../utils/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const draftID = "draft_new_session_panel_corner"
const directory = "C:/OpenCode/NewSessionPanelCorner"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({
  viewport: { width: 935, height: 522 },
  deviceScaleFactor: 1,
})

test("matches the rounded panel corners to the dark new-session background", async ({ page }, testInfo) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_new_session_panel_corner",
      worktree: directory,
      vcs: "git",
      name: "new-session-panel-corner",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory, draftID, server }) => {
      localStorage.setItem("opencode-theme-id", "oc-2")
      localStorage.setItem("opencode-color-scheme", "dark")
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory }]),
      )
    },
    { directory, draftID, server },
  )

  await page.goto(`/new-session?draftId=${draftID}`)
  await expectAppVisible(page.locator('[data-component="composer-editor"]'))
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const panel = page.locator('main [data-component="new-session"]')
  await expect(panel).toHaveCount(1)
  const box = await panel.boundingBox()
  if (!box) throw new Error("New-session panel bounds are unavailable")

  const screenshot = await page.screenshot({ path: testInfo.outputPath("new-session-dark.png") })
  const corners = await page.evaluate(
    async ({ source, points }) => {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext("2d")
      if (!context) throw new Error("2D canvas is unavailable")
      context.drawImage(image, 0, 0)
      return points.map((point) => Array.from(context.getImageData(point.x, point.y, 1, 1).data))
    },
    {
      source: `data:image/png;base64,${screenshot.toString("base64")}`,
      points: [
        { x: Math.floor(box.x), y: Math.floor(box.y) },
        { x: Math.ceil(box.x + box.width) - 1, y: Math.floor(box.y) },
        { x: Math.floor(box.x), y: Math.ceil(box.y + box.height) - 1 },
        { x: Math.ceil(box.x + box.width) - 1, y: Math.ceil(box.y + box.height) - 1 },
      ],
    },
  )

  // Buff (#471): the dark deep background is the cabinet's slate, not upstream's near-black, so the
  // corners are matched to that color. Buff (#584): the React window's page is @buff/ui's background.
  const deep = await page.evaluate(() => {
    const probe = document.createElement("span")
    probe.style.color = "var(--v2-background-bg-deep, var(--background))"
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color.match(/\d+/g)!.slice(0, 3).map(Number)
  })
  expect(
    corners.every(
      ([red, green, blue, alpha]) =>
        Math.abs(red! - deep[0]!) <= 8 &&
        Math.abs(green! - deep[1]!) <= 8 &&
        Math.abs(blue! - deep[2]!) <= 8 &&
        alpha === 255,
    ),
    JSON.stringify({ corners, deep }),
  ).toBe(true)
})
