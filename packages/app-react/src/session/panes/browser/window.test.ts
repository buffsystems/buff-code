import { expect, test } from "bun:test"
import type { BrowserPanePlatform } from "@opencode/app/react-reuse/browser-pane"
import { createBrowserAttachments } from "./attachments"
import { windowSettings } from "../../../shell/settings-model"
import { memoryStorage } from "../../../test/storage"
import { browserWindow, syncTabOwnership } from "./window"

const text = { replaced: "", failed: "" }

test("the experimental browser follows the window's settings model, live", async () => {
  const pane: BrowserPanePlatform = {
    register: () => ({ setLayout: () => undefined, command: async () => undefined, close: () => undefined }),
  }
  const storage = memoryStorage({ "settings.v3": JSON.stringify({ general: { experimentalBrowser: true } }) })
  const platform = { browserPane: pane, storage: () => storage }
  const settings = windowSettings(platform.storage)
  await settings.ready
  const browser = browserWindow({ platform }, text)
  expect(browser?.enabled.get()).toBe(true)
  settings.general({ experimentalBrowser: false })
  expect(browser?.enabled.get()).toBe(false)
  expect(browserWindow({ platform: { storage: () => storage } }, text)).toBeUndefined()
})

test("an attachment closes with the shell tab that owned it, not before the tabs are known", () => {
  const closed: string[] = []
  const pane: BrowserPanePlatform = {
    register: (target) => ({
      setLayout: () => undefined,
      command: async () => undefined,
      close: () => void closed.push(target.sessionID),
    }),
  }
  const attachments = createBrowserAttachments({ pane, enabled: () => true, messages: { replaced: "", failed: "" } })
  const server = { key: "s", endpoint: () => ({ url: "http://s" }), listen: () => () => undefined }
  attachments.attach(server, "ses_1")
  syncTabOwnership(attachments, () => undefined, () => false)
  expect(closed).toEqual([])
  syncTabOwnership(attachments, () => "tab-1", () => true)
  expect(closed).toEqual([])
  syncTabOwnership(attachments, () => undefined, () => false)
  expect(closed).toEqual(["ses_1"])
})
