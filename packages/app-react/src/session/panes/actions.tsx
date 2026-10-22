// Over the panels (#584): the review toggle, and the panes' commands — registered here because
// this slot is shown whether or not the side and bottom regions are open.

import { IconButton, Kbd, Tooltip } from "@buff/ui/react"
import { PanelRight } from "lucide-react"
import { useEffect } from "react"
import { flushSync } from "react-dom"
import { formatKeybindParts, type KeyLabel } from "../../commands/keybind"
import { useCommandRegistration, useCommands } from "../../commands/provider"
import { PALETTE_ID } from "../../commands/registry"
import { useI18n } from "../../i18n/provider"
import { useSideController } from "./controller"
import { registerSideActions } from "./side-actions"
import { useBrowserCommands } from "./browser/model"
import { useTerminalCommands } from "./terminal/commands"

export function PanelActions() {
  useTerminalCommands()
  useBrowserCommands()
  const side = useSideCommands()
  // The panels move in the click's own task, as in the Solid window: nothing paints in between.
  return <ReviewToggle opened={side.view.review} onToggle={() => flushSync(side.view.toggleReview)} />
}

function useSideCommands() {
  const i18n = useI18n()
  const commands = useCommands()
  const side = useSideController()
  const files = side.session.files
  const view = i18n.t("command.category.view")
  const file = i18n.t("command.category.file")

  useCommandRegistration("session.panes", () => [
    {
      id: "review.toggle",
      title: i18n.t("command.review.toggle"),
      category: view,
      keybind: "mod+shift+r",
      onSelect: side.view.toggleReview,
    },
    {
      // The menu's View › Toggle file tree: the tree beside the review and the file browser.
      id: "fileTree.toggle",
      title: i18n.t("command.fileTree.toggle"),
      category: view,
      keybind: "mod+\\",
      onSelect: () => {
        if (!side.view.review) {
          side.view.openReview()
          if (!side.session.window.layout.panel.get().sidebarOpened) side.session.window.layout.toggleSidebar()
          return
        }
        side.session.window.layout.toggleSidebar()
      },
    },
    {
      id: "file.open",
      title: i18n.t("command.file.open"),
      description: i18n.t("palette.search.placeholder"),
      category: file,
      keybind: "mod+p",
      slash: "open",
      onSelect: () => commands.trigger(PALETTE_ID),
    },
    ...(side.derived.closableTab
      ? [
          {
            id: "file.close",
            title: i18n.t("command.tab.close"),
            category: file,
            keybind: "mod+w",
            when: (event: KeyboardEvent) =>
              !(event.target instanceof Element && event.target.closest('[data-component="terminal"]')),
            onSelect: side.closeActive,
          },
        ]
      : []),
  ])

  const latest = { side, files }
  useEffect(
    () =>
      registerSideActions({
        openFile: (path) => latest.side.openFile(path),
        openContext: () => latest.side.openContext(),
        toggleContext: () => {
          const { side } = latest
          if (side.view.review && side.derived.activeTab === "context") return side.close("context")
          side.openContext()
        },
        searchFiles: (query, signal) => latest.files?.searchFiles(query, { signal }) ?? Promise.resolve([]),
        recentFiles: () => {
          const { derived, pathFromTab } = latest.side
          const paths = derived.openedTabs.flatMap((tab) => pathFromTab(tab) ?? [])
          const active = derived.activeFileTab ? pathFromTab(derived.activeFileTab) : undefined
          return { paths, active }
        },
      }),
  )
  return side
}

function ReviewToggle(props: { opened: boolean; onToggle: () => void }) {
  const i18n = useI18n()
  const commands = useCommands()
  const label = i18n.t("command.review.toggle")
  const keybind = commands.keybind("review.toggle")
  return (
    <Tooltip
      side="bottom"
      content={
        <span className="flex items-center gap-2">
          {label}
          {keybind &&
            formatKeybindParts(keybind, (key: KeyLabel) => i18n.t(key)).map((part) => <Kbd key={part}>{part}</Kbd>)}
        </span>
      }
    >
      <IconButton
        icon={PanelRight}
        size="xs"
        className="shrink-0"
        data-pressed={props.opened ? "" : undefined}
        aria-label={label}
        aria-expanded={props.opened}
        aria-controls="review-panel"
        onClick={props.onToggle}
      />
    </Tooltip>
  )
}
