import { describe, expect, test } from "bun:test"
import type { BrowserPaneEvent, BrowserPanePlatform, BrowserPaneTarget } from "@opencode/app/react-reuse/browser-pane"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { attachmentKey, createBrowserAttachments, type BrowserServer } from "./attachments"

function fakePane() {
  const registrations: { target: BrowserPaneTarget; emit: (event: BrowserPaneEvent) => void; closed: boolean; commands: unknown[] }[] = []
  const pane: BrowserPanePlatform = {
    register(target, listener) {
      const entry = { target, emit: listener, closed: false, commands: [] as unknown[] }
      registrations.push(entry)
      return {
        setLayout: () => undefined,
        command: async (command) => void entry.commands.push(command),
        close: () => void (entry.closed = true),
      }
    },
  }
  return { pane, registrations }
}

function fakeServer(key = "http://server.test") {
  const handlers = new Set<(event: OpenCodeEvent) => void>()
  const server: BrowserServer = {
    key,
    endpoint: () => ({ url: key }),
    listen: (handler) => {
      handlers.add(handler)
      return () => void handlers.delete(handler)
    },
  }
  return { server, handlers }
}

const messages = { replaced: "replaced", failed: "failed" }
const tab = { id: "tab_1", url: "https://example.test", title: "Example", loading: false, canGoBack: false, canGoForward: false, generation: 1 }

describe("createBrowserAttachments", () => {
  test("attaches nothing without a pane or with the setting off", () => {
    const off = createBrowserAttachments({ enabled: () => true, messages })
    off.attach(fakeServer().server, "ses_1")
    expect(off.store.get()).toEqual({})
    const fake = fakePane()
    const disabled = createBrowserAttachments({ pane: fake.pane, enabled: () => false, messages })
    disabled.attach(fakeServer().server, "ses_1")
    expect(fake.registrations).toHaveLength(0)
  })

  test("registers a session once and follows its state", () => {
    const fake = fakePane()
    const { server } = fakeServer()
    const attachments = createBrowserAttachments({ pane: fake.pane, enabled: () => true, messages })
    attachments.attach(server, "ses_1")
    attachments.attach(server, "ses_1")
    expect(fake.registrations).toHaveLength(1)
    expect(fake.registrations[0]?.target).toEqual({ serverKey: server.key, sessionID: "ses_1", endpoint: { url: server.key } })
    fake.registrations[0]?.emit({ type: "state", state: { tabs: [tab], focusedTabID: null } as never })
    expect(attachments.state(server.key, "ses_1")?.browser?.tabs).toHaveLength(1)
    fake.registrations[0]?.emit({ type: "state", state: null, error: "boom" })
    expect(attachments.state(server.key, "ses_1")?.error).toBe("failed")
  })

  test("an unsupported server is closed and never asked again", () => {
    const fake = fakePane()
    const { server } = fakeServer()
    const attachments = createBrowserAttachments({ pane: fake.pane, enabled: () => true, messages })
    attachments.attach(server, "ses_1")
    fake.registrations[0]?.emit({ type: "state", state: null, error: "browser.pane.unsupported" })
    expect(attachments.supported(server.key)).toBe(false)
    expect(attachments.state(server.key, "ses_1")).toBeUndefined()
    attachments.attach(server, "ses_2")
    expect(fake.registrations).toHaveLength(1)
  })

  test("focus requests reach the session's listeners and commands its registration", async () => {
    const fake = fakePane()
    const { server } = fakeServer()
    const attachments = createBrowserAttachments({ pane: fake.pane, enabled: () => true, messages })
    attachments.attach(server, "ses_1")
    const focused: string[] = []
    const stop = attachments.onFocus(server.key, "ses_1", (id) => focused.push(id))
    fake.registrations[0]?.emit({ type: "focus", tabID: tab.id as never })
    stop()
    fake.registrations[0]?.emit({ type: "focus", tabID: tab.id as never })
    expect(focused).toEqual([tab.id])
    await attachments.command(server.key, "ses_1", { type: "tabs.open" } as never)
    expect(fake.registrations[0]?.commands).toEqual([{ type: "tabs.open" }])
    await expect(attachments.command(server.key, "ses_9", { type: "tabs.open" } as never)).rejects.toThrow()
  })

  test("retain closes attachments whose session tab is gone", () => {
    const fake = fakePane()
    const { server, handlers } = fakeServer()
    const attachments = createBrowserAttachments({ pane: fake.pane, enabled: () => true, messages })
    attachments.attach(server, "ses_1")
    attachments.attach(server, "ses_2")
    attachments.retain((_, sessionID) => sessionID === "ses_2")
    expect(fake.registrations[0]?.closed).toBe(true)
    expect(fake.registrations[1]?.closed).toBe(false)
    expect(Object.keys(attachments.store.get()).filter((id) => attachments.store.get()[id])).toEqual([
      attachmentKey(server.key, "ses_2"),
    ])
    expect(handlers.size).toBe(1)
  })
})
