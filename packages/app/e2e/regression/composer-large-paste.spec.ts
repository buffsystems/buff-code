import { expect, test, type Locator, type Page } from "../utils/test"
import { BuffComposerParts } from "@opencode/schema/buff-composer-parts"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const draftID = "draft_large_paste"
const directory = "/repo/large-paste"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_large_paste",
      worktree: directory,
      vcs: "git",
      name: "large-paste",
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
  const input = page.locator('[data-component="composer-editor"]')
  await expectAppVisible(input)
  await expect(input).toBeEditable()
  await expect
    .poll(() => input.evaluate((element) => getComputedStyle(element, "::before").content))
    .toBe(`"${String.fromCodePoint(0x200b)}"`)
  await input.click()
})

for (const lines of [6000, 25000]) {
  test(`keeps a ${lines}-line crash report editable in a new session`, async ({ page }) => {
    const input = page.getByRole("textbox", { name: "Prompt", exact: true })
    const text = "Thread 0 Crashed:\n" + "0   Example  0x0000000100000000 frame + 32\n".repeat(lines) + "End of report"
    await page.evaluate((text) => navigator.clipboard.writeText(text), text)
    const events = await input.evaluateHandle((element) => {
      const events = { count: 0 }
      element.addEventListener("input", () => events.count++)
      return events
    })
    await page.keyboard.press("ControlOrMeta+V")
    // Buff (#459): a large paste lands as a chip beside the field; expanding it puts the whole text
    // into the field at once, which is where the editor's large-text behaviour is exercised.
    await expandPasteChip(page, text)
    await expect.poll(async () => (await input.innerText()) === text).toBe(true)
    expect(await events.evaluate((events) => events.count)).toBe(0)
    await input.focus()
    await page.keyboard.press("ControlOrMeta+End")
    await expect(input).toBeFocused()
    const scroll = page.locator('[data-component="composer-scroll"]')
    await expect(scroll.locator(".scroll-view__viewport")).toHaveCSS("scrollbar-width", "none")
    await expect(scroll.locator(".scroll-view__thumb")).toBeVisible()
    await page.keyboard.type("!")
    await expect.poll(async () => (await input.innerText()) === text + "!").toBe(true)
    await expectCaretVisible(input)
    const thumb = await scroll.locator(".scroll-view__thumb").boundingBox()
    const bounds = await scroll.boundingBox()
    if (!thumb || !bounds) throw new Error("Missing composer scrollbar bounds")
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2)
    await page.mouse.down()
    await page.mouse.move(thumb.x + thumb.width / 2, bounds.y + 8 + thumb.height / 2)
    await page.mouse.up()
    await expect(scroll.locator(".scroll-view__viewport")).toHaveJSProperty("scrollTop", 0)
    await expect(input).toBeFocused()
    await page.keyboard.press("ControlOrMeta+Home")
    await page.keyboard.press("ControlOrMeta+End")
    await expectCaretVisible(input)
  })
}

async function expandPasteChip(page: Page, text: string) {
  const chip = page.locator('[data-component="buff-text-chip"][data-kind="paste"]')
  await expect(chip).toHaveCount(1)
  await expect(chip.locator(".buff-text-chip-label")).toHaveText(BuffComposerParts.pasteLabel(text))
  await chip.click()
  const preview = page.locator('[data-component="buff-text-preview"]')
  await expect(preview.locator("pre")).toHaveText(text)
  await preview.locator('[data-action="buff-text-expand"]').click()
  await expect(chip).toHaveCount(0)
}

function caretOffset(input: Locator) {
  return input.evaluate((element) => {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return -1
    const range = document.createRange()
    range.setStart(element, 0)
    range.setEnd(selection.anchorNode!, selection.anchorOffset)
    return range.toString().length
  })
}

async function expectCaretVisible(input: Locator) {
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const selection = window.getSelection()
        if (!selection?.isCollapsed || !selection.rangeCount || !element.contains(selection.anchorNode)) return false
        const caret = selection.getRangeAt(0).getBoundingClientRect()
        const viewport = (element.closest("[data-scrollable]") ?? element).getBoundingClientRect()
        return caret.height > 0 && caret.top >= viewport.top - 1 && caret.bottom <= viewport.bottom + 1
      }),
    )
    .toBe(true)
}

for (const width of [390, 1280]) {
  for (const direction of ["ltr", "rtl"]) {
    test(`reveals a multiline paste in the middle at ${width}px in ${direction}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
      const input = page.getByRole("textbox", { name: "Prompt", exact: true })
      const suffix = "\nExisting trailing content".repeat(100)
      await input.fill("Before " + suffix)
      // Placing the caret is idempotent; under load the field can drop the first move while the
      // filled draft settles, so the placement is retried until the caret sits after "B".
      await expect(async () => {
        await input.press("ControlOrMeta+Home")
        await input.press("ArrowRight")
        expect(await caretOffset(input)).toBe(1)
      }).toPass()
      // Buff (#459): a paste of three lines or more becomes a chip, so the in-field paste stays under that.
      const text = "Pasted line /tmp/example.ts 123 \u0645\u0631\u062d\u0628\u0627\n" + "End of paste"
      expect(BuffComposerParts.isLargePaste(text)).toBe(false)
      await page.evaluate((text) => navigator.clipboard.writeText(text), text)
      await page.keyboard.press("ControlOrMeta+V")
      await expect.poll(() => input.innerText()).toBe("B" + text + "efore " + suffix)
      await expectCaretVisible(input)
      await page.keyboard.type("!")
      await expect.poll(() => input.innerText()).toBe("B" + text + "!efore " + suffix)
      await expectCaretVisible(input)
    })
  }
}

for (const text of [
  "single line <b> &amp;",
  "first\nsecond",
  "\n\n  indented\ttext  \n\nlast\n\n",
  'literal <b>bold</b> &amp; & < > "quotes"\n<script>not code</script>\n<img src="example">',
  "first\r\nsecond\rthird",
]) {
  test(`preserves text and native undo: ${JSON.stringify(text)}`, async ({ page }) => {
    const input = page.getByRole("textbox", { name: "Prompt", exact: true })
    await page.evaluate((text) => navigator.clipboard.writeText(text), text)
    await page.keyboard.press("ControlOrMeta+V")
    const expected = text.replace(/\r\n?/g, "\n")
    // Buff (#459): a large paste is a chip that keeps the text verbatim and inert until expanded.
    if (BuffComposerParts.isLargePaste(expected)) {
      await expect(input).toBeEmpty()
      await expandPasteChip(page, expected)
      await expect.poll(() => input.innerText()).toBe(expected)
      await expect(input.locator("b, script, img")).toHaveCount(0)
      return
    }
    await expect.poll(() => input.innerText()).toBe(expected)
    await expect(input.locator("b, script, img")).toHaveCount(0)
    await page.keyboard.press("ControlOrMeta+Z")
    await expect(input).toBeEmpty()
    await page.keyboard.press("ControlOrMeta+Shift+Z")
    await expect.poll(() => input.innerText()).toBe(expected)
  })
}

test("replaces only the selected text and leaves the caret after the paste", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Prompt", exact: true })
  await page.evaluate(() => navigator.clipboard.writeText("one\ntwo"))
  await page.keyboard.type("before replace after")
  await expect(input).toHaveText("before replace after")
  await page.evaluate(() => document.fonts.ready)
  const word = await input.evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 7)
    range.setEnd(element.firstChild!, 14)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y + rect.height / 2, width: rect.width }
  })
  await page.mouse.move(word.x, word.y)
  await page.mouse.down()
  await page.mouse.move(word.x + word.width, word.y, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("replace")
  await page.keyboard.press("ControlOrMeta+V")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo after")
  await page.keyboard.press("ControlOrMeta+Z")
  await expect(input).toHaveText("before replace after")
  await page.keyboard.press("ControlOrMeta+Shift+Z")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo after")
  await page.keyboard.type("!")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo! after")
})
