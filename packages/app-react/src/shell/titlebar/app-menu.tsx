// The application menu inside the window (#584), the Solid window's WindowsAppMenu: Windows and Linux
// have no menu bar of ours, so the desktop menu (DESKTOP_MENU) opens from a titlebar button. Items
// run the window's commands, the main process's menu actions or open a link; an action's Windows
// accelerator works while the menu is closed.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
} from "@buff/ui/react"
import {
  DESKTOP_MENU,
  desktopMenuVisible,
  type DesktopMenuAction,
  type DesktopMenuItem,
} from "@opencode/app/desktop-menu"
import { Menu } from "lucide-react"
import { useEffect, useRef } from "react"
import { formatKeybind, matchKeybind, parseKeybind, type KeyLabel } from "../../commands/keybind"
import { useCommands } from "../../commands/provider"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"

const MENUS = DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "windows"))

const accelerators = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).flatMap((entry) => {
  if (entry.type === "separator" || !entry.action || !entry.accelerator?.windows) return []
  // Editing shortcuts stay with the focused editor.
  if (entry.action.startsWith("edit.")) return []
  return [{ action: entry.action, keybind: parseKeybind(entry.accelerator.windows, false) }]
})

/** The menu action a key press asks for, by the Windows accelerators. */
export function appMenuAccelerator(event: KeyboardEvent) {
  return accelerators.find((entry) => matchKeybind(entry.keybind, event))?.action
}

export function AppMenu() {
  const i18n = useI18n()
  const platform = usePlatform()
  const commands = useCommands()
  // Editing actions act on what had focus before the menu took it.
  const lastFocused = useRef<HTMLElement | undefined>(undefined)
  const rememberFocus = () => {
    const active = document.activeElement
    lastFocused.current = active instanceof HTMLElement ? active : undefined
  }
  const runAction = (action: DesktopMenuAction) => {
    if (action.startsWith("edit.") && lastFocused.current?.isConnected)
      lastFocused.current.focus({ preventScroll: true })
    platform.runDesktopMenuAction?.(action)
  }
  const disabled = (id: string) => {
    const option = commands.options().find((item) => item.id === id)
    return !option || !!option.disabled
  }
  const run = (entry: DesktopMenuItem) => {
    if (entry.command) {
      if (!disabled(entry.command)) commands.trigger(entry.command)
      return
    }
    if (entry.action) return runAction(entry.action)
    if (entry.href) platform.openExternal(entry.href)
  }
  // A command shows the window's keybind for it; an action, its Windows accelerator as written.
  const shortcut = (entry: DesktopMenuItem) => {
    if (!entry.command) return entry.accelerator?.windows
    const keybind = commands.keybind(entry.command)
    return keybind ? formatKeybind(keybind, (key: KeyLabel) => i18n.t(key)) : undefined
  }

  const latest = useRef(runAction)
  latest.current = runAction
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const action = appMenuAccelerator(event)
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      latest.current(action)
    }
    document.addEventListener("keydown", onKeyDown, { capture: true })
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [])

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={Menu}
          size="sm"
          data-action="desktop-app-menu"
          aria-label={i18n.t("desktop.menu.ariaLabel")}
          onPointerDown={rememberFocus}
          onKeyDown={rememberFocus}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="desktop-app-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Buff Code</DropdownMenuLabel>
          {MENUS.map((menu) => (
            <DropdownMenuSub key={menu.id}>
              <DropdownMenuSubTrigger>{i18n.t(menu.labelKey)}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="desktop-app-menu">
                {(menu.items ?? [])
                  .filter((entry) => desktopMenuVisible(entry, "windows"))
                  .map((entry, index) =>
                    entry.type === "separator" ? (
                      <DropdownMenuSeparator key={`separator-${index}`} />
                    ) : (
                      <DropdownMenuItem
                        key={entry.labelKey ?? index}
                        disabled={entry.command ? disabled(entry.command) : false}
                        shortcut={shortcut(entry)}
                        onSelect={() => run(entry)}
                      >
                        {entry.labelKey ? i18n.t(entry.labelKey) : ""}
                      </DropdownMenuItem>
                    ),
                  )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
