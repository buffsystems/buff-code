// Окно контекста (#836, эпик #783): контрол «Context window» рядом с режимом размышлений —
// пресеты в пределах окна модели, свой размер через диалог; выбор уходит на сервер, событие
// возвращает его в контрол и строкой в ленту.
import { expect, test } from "../utils/test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { base64Encode } from "@opencode/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/ComposerContextLimit"
const projectID = "proj_composer_context_limit"
const sessionID = "ses_composer_context_limit"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("offers the presets within the model's window, sends the choice and shows it back from the event", async ({
  page,
}) => {
  const events: OpenCodeEvent[] = []
  const sent: unknown[] = []
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "composer-context-limit",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "window-model": { id: "window-model", name: "Window Model", limit: { context: 400_000 }, variants: {} },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "window-model" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "composer-context-limit",
        projectID,
        directory,
        title: "Composer context limit",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    // One exchange of 100k tokens: a quarter of the model's window, half of a 200k cap.
    pageMessages: () => ({
      items: [
        { id: "msg_user_1", type: "user", text: "Hello", time: { created: 1700000000001 } },
        {
          id: "msg_assistant_1",
          type: "assistant",
          agent: "build",
          model: { id: "window-model", providerID: "opencode" },
          time: { created: 1700000000002, completed: 1700000000003 },
          content: [{ type: "text", text: "Hi" }],
          tokens: { input: 90_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      ] satisfies SessionMessageInfo[],
    }),
    events: () => events.splice(0),
  })
  // The server records the cap and answers with the event every client reads it from.
  await page.route("**/api/session/*/context-limit", async (route) => {
    const payload = route.request().postDataJSON() as { limit: { context: number } | null }
    sent.push(payload)
    events.push({
      id: `evt_context_${sent.length}`,
      created: 1700000000000 + sent.length,
      type: "session.context.selected",
      location: { directory },
      durable: { aggregateID: sessionID, seq: sent.length, version: 1 },
      data: { sessionID, ...(payload.limit ? { limit: payload.limit } : {}) },
    } as OpenCodeEvent)
    await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
  })

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  const composer = page.locator('[data-component="composer"]')
  const input = composer.getByRole("textbox", { name: "Prompt", exact: true })
  const control = composer.getByRole("button", { name: "Context window", exact: true })
  await expectAppVisible(composer)

  // The model's whole window by default: the control hides like the default thinking mode.
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("Model maximum, 400k")
  await expect(control).toHaveCSS("opacity", "0")
  const usage = page.getByRole("button", { name: "View context usage" })
  await usage.hover()
  await expect(page.getByRole("tooltip")).toContainText("25%")
  await page.mouse.move(0, 0)

  await input.hover()
  await control.click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitemradio", { name: /^Model maximum, 400k/ })).toBeVisible()
  await expect(menu.getByRole("menuitemradio", { name: /^Compact, 64k/ })).toBeVisible()
  await expect(menu.getByRole("menuitemradio", { name: /^Mid-size, 200k/ })).toBeVisible()
  // 500k does not fit a 400k model.
  await expect(menu.getByRole("menuitemradio", { name: /^Large/ })).toHaveCount(0)
  await menu.getByRole("menuitemradio", { name: /^Mid-size, 200k/ }).click()

  await expect.poll(() => sent).toEqual([{ limit: { context: 200_000 } }])
  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("Mid-size, 200k")
  await expect(control).toHaveCSS("opacity", "1")
  const notice = page.locator('[data-slot="session-timeline-notice"][data-type="context-switched"]')
  await expect(notice).toHaveText(/Context limit: Mid-size, 200k/)
  // The usage is read against the cap now.
  await usage.hover()
  await expect(page.getByRole("tooltip")).toContainText("50%")
  await page.mouse.move(0, 0)

  // A custom size through the dialog, within the model's window.
  await input.hover()
  await control.click()
  await page.getByRole("menuitemradio", { name: /^Own size/ }).click()
  const dialog = page.getByRole("dialog", { name: "Context window" })
  await expect(dialog).toBeVisible()
  const field = dialog.getByRole("textbox", { name: "Context limit in tokens" })
  await field.fill("900k")
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled()
  await field.fill("150k")
  await dialog.getByRole("button", { name: "Apply" }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => sent).toEqual([{ limit: { context: 200_000 } }, { limit: { context: 150_000 } }])
  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("Own size, 150k")
  await expect(notice).toHaveCount(2)

  // Back to the model's window: the server gets no limit.
  await input.hover()
  await control.click()
  await page.getByRole("menuitemradio", { name: /^Model maximum/ }).click()
  await expect.poll(() => sent.length).toBe(3)
  expect(sent[2]).toEqual({ limit: null })
  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("Model maximum, 400k")
  await expect(notice.last()).toHaveText(/Context limit: Model maximum/)
})

// Настройки → Модели → «Режимы по умолчанию» (#836): дефолты новой сессии из конфига сервера,
// запись через config.update.
test("the Models settings show the default modes from the config and write a change back", async ({ page }) => {
  const patches: unknown[] = []
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "composer-context-limit",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    configEntries: [{ type: "document", info: { thinking: "low", context: 64_000 } }],
  })
  await page.route("**/api/experimental/config", async (route) => {
    patches.push(route.request().postDataJSON())
    await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
  })
  await page.goto("/settings")
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Models", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Default modes", exact: true })).toBeVisible()

  const thinking = settings.getByRole("combobox", { name: "Thinking mode", exact: true })
  await expect(thinking).toHaveText("Low")
  await thinking.click()
  await page.getByRole("option", { name: /^High/ }).click()
  await expect(thinking).toHaveText("High")
  await expect.poll(() => patches).toEqual([{ thinking: "high" }])

  const context = settings.getByRole("combobox", { name: "Context window", exact: true })
  await expect(context).toHaveText("Compact, 64k")
  await context.click()
  await page.getByRole("option", { name: /^Mid-size, 200k/ }).click()
  await expect(context).toHaveText("Mid-size, 200k")
  await expect.poll(() => patches).toEqual([{ thinking: "high" }, { context: 200_000 }])

  await context.click()
  await page.getByRole("option", { name: /^Own size/ }).click()
  const own = settings.getByRole("textbox", { name: "Own size", exact: true })
  await own.fill("150k")
  await own.press("Enter")
  await expect(context).toHaveText("Own size, 150k")
  await expect.poll(() => patches).toEqual([{ thinking: "high" }, { context: 200_000 }, { context: 150_000 }])

  // Back to the model's window: the key is cleared.
  await context.click()
  await page.getByRole("option", { name: /^Model maximum/ }).click()
  await expect(context).toHaveText("Model maximum")
  await expect.poll(() => patches.length).toBe(4)
  expect(patches[3]).toEqual({ context: null })
})
