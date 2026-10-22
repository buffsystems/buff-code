// The browser attachments of one window (#584): created once per Core, only when the host has a
// native browser pane (the desktop), so the web build pays nothing. The experimental setting comes
// from the window's settings model, so turning it on or off applies at once; attachments follow the
// shell's session tabs.

import { derive, type Readable } from "../../../core/store"
import type { Platform } from "../../../platform/platform"
import { windowSettings } from "../../../shell/settings-model"
import { createBrowserAttachments, type BrowserAttachments } from "./attachments"

export type BrowserWindow = { attachments: BrowserAttachments; enabled: Readable<boolean> }
type BrowserHost = { platform: Pick<Platform, "browserPane" | "storage"> }

const windows = new WeakMap<BrowserHost, BrowserWindow>()
const messages = { replaced: "", failed: "" }

/** The window's attachments, or undefined on a host without a native browser. */
export function browserWindow(core: BrowserHost, text: { replaced: string; failed: string }): BrowserWindow | undefined {
  Object.assign(messages, text)
  const pane = core.platform.browserPane
  if (!pane) return
  const existing = windows.get(core)
  if (existing) return existing
  const enabled = derive(windowSettings(core.platform.storage).store, (settings) => settings.general.experimentalBrowser)
  const attachments = createBrowserAttachments({ pane, enabled: () => enabled.get(), messages })
  // Turning the setting off closes every page; turning it on attaches on the next session render.
  enabled.subscribe(() => attachments.retain(() => enabled.get()))
  const created = { attachments, enabled }
  windows.set(core, created)
  return created
}

const owners = new WeakMap<BrowserAttachments, Map<string, string>>()

/**
 * Close the attachments whose session tab was closed. A tab owns an attachment once seen; until the
 * tabs hydrate, an attachment not seen in any tab stays.
 */
export function syncTabOwnership(
  attachments: BrowserAttachments,
  find: (serverKey: string, sessionID: string) => string | undefined,
  present: (tabKey: string) => boolean,
) {
  const known = owners.get(attachments) ?? new Map<string, string>()
  owners.set(attachments, known)
  attachments.retain((serverKey, sessionID) => {
    const id = `${serverKey}\n${sessionID}`
    const owner = find(serverKey, sessionID)
    if (owner) known.set(id, owner)
    const tab = known.get(id)
    return tab === undefined || present(tab)
  })
}
