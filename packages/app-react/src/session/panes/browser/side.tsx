// The browser's pieces of the side panel (#584): a browser tab's trigger, its tab panel and the
// "+" menu that adds a file or a browser tab — the Solid SessionSidePanel's browser branches.

import { isSessionBrowserTab, sessionBrowserTab } from "@opencode/app/react-reuse/session-tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Tooltip,
} from "@buff/ui/react"
import { FolderTree, Globe, Plus } from "lucide-react"
import type { ReactNode } from "react"
import { formatKeybindParts, type KeyLabel } from "../../../commands/keybind"
import { useCommands } from "../../../commands/provider"
import { useI18n } from "../../../i18n/provider"
import { SortablePaneTab } from "../tabs"
import type { BrowserTabState } from "./attachments"
import type { SessionBrowser } from "./model"
import { BrowserPane } from "./pane"

export const BROWSER_TAB_ID = "session-side-panel-browser-tab"
export const BROWSER_PANEL_ID = "session-side-panel-browser-tabpanel"

/** The browser tab of `tab` (a side tab key), when it is one the desktop still has. */
export function browserTabOf(browser: SessionBrowser, tab: string) {
  if (!isSessionBrowserTab(tab)) return
  return browser.tabs.find((item) => sessionBrowserTab(item.id) === tab)
}

export function BrowserTabTrigger(props: {
  browser: SessionBrowser
  tab: BrowserTabState
  index: number
  selected: boolean
  onSelect: () => void
  closeHint?: ReactNode
}) {
  const i18n = useI18n()
  const key = sessionBrowserTab(props.tab.id)
  const title =
    !props.tab.url || props.tab.url === "about:blank" ? i18n.t("session.tab.browser") : props.tab.title || props.tab.url
  return (
    <SortablePaneTab
      value={key}
      index={props.index}
      id={`${BROWSER_TAB_ID}-${props.tab.id}`}
      ariaControls={props.selected ? BROWSER_PANEL_ID : undefined}
      selected={props.selected}
      onSelect={props.onSelect}
      onClose={() => props.browser.close(props.tab.id)}
      closeHint={props.closeHint}
    >
      <span className="flex items-center gap-1.5">
        <Globe aria-hidden className="size-4 shrink-0" />
        <span className="max-w-40 truncate">{title}</span>
      </span>
    </SortablePaneTab>
  )
}

/** Mounted while the session has browser tabs; shown only while one of them is selected. */
export function BrowserTabPanel(props: { browser: SessionBrowser; activeTab: string; panelOpen: boolean }) {
  if (!props.browser.opened) return null
  const shown = isSessionBrowserTab(props.activeTab)
  const active = props.browser.active
  return (
    <div
      id={BROWSER_PANEL_ID}
      role="tabpanel"
      aria-labelledby={active ? `${BROWSER_TAB_ID}-${active.id}` : undefined}
      data-slot="tabs-content"
      className={shown ? "h-full min-h-0 overflow-hidden" : "hidden"}
      inert={!shown}
    >
      <BrowserPane browser={props.browser} visible={props.panelOpen && shown} />
    </div>
  )
}

function Shortcut(props: { id: string }) {
  const i18n = useI18n()
  const keybind = useCommands().keybind(props.id)
  if (!keybind) return null
  return (
    <span className="ms-auto flex gap-1 ps-6">
      {formatKeybindParts(keybind, (key: KeyLabel) => i18n.t(key)).map((part) => (
        <Kbd key={part}>{part}</Kbd>
      ))}
    </span>
  )
}

/** The "+" when a browser can be added: a menu of "Open file" and "Browser". */
export function AddTabMenu(props: { browser: SessionBrowser; onOpenFile: () => void }) {
  const i18n = useI18n()
  const label = i18n.t("session.tab.add")
  return (
    <DropdownMenu modal={false}>
      <Tooltip content={label} side="bottom">
        <DropdownMenuTrigger asChild>
          <IconButton
            icon={Plus}
            size="md"
            aria-label={label}
          />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={props.onOpenFile}>
          <FolderTree aria-hidden className="size-4" />
          <span>{i18n.t("command.file.open")}</span>
          <Shortcut id="file.open" />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.browser.open}>
          <Globe aria-hidden className="size-4" />
          <span>{i18n.t("session.tab.browser")}</span>
          <Shortcut id="browser.open" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
