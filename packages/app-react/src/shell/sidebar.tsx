// The vertical column (#584, Buff #452): Home, Buff's pages and a new session at the top, the
// open tabs under them, then every session of the server with its state; the phone and the
// settings beside the pages at the top (#704, #709).

import { ResizeHandle } from "@buff/ui/react"
import { House, Settings, Smartphone, SquarePen, type LucideIcon } from "lucide-react"
import { useState, type ReactNode } from "react"
import { formatKeybind, type KeyLabel } from "../commands/keybind"
import { useCommands } from "../commands/provider"
import { useI18n } from "../i18n/provider"
import { useStore } from "../react/use-store"
import { useNavigate, useRoute } from "../router/router"
import { useSettingsState, useSettingsSurface } from "../settings/context"
import { useShellActions } from "./actions"
import { PAGE_ENTRIES } from "./page-entries"
import { WindowTabs } from "./tabs/tab-strip"
import { UpdateButton, useUpdaterState } from "./updates/update-button"
import { updateNotice } from "./updates/updater"
import { macClearance, useDesktopChrome } from "./titlebar/chrome"

export function VerticalSidebar(props: { sessions?: ReactNode }) {
  const i18n = useI18n()
  const route = useRoute()
  const navigate = useNavigate()
  const actions = useShellActions()
  const update = updateNotice(useUpdaterState()).visible
  const [width, setWidth] = useState(260)
  const clearance = macClearance(useDesktopChrome())
  return (
    <aside
      data-slot="vertical-tabs-sidebar"
      className="relative flex h-full min-h-0 shrink-0 flex-col pe-0.5 ps-2.5 pb-2.5 pt-2"
      style={{ width }}
    >
      <ResizeHandle
        data-component="resize-handle"
        direction="horizontal"
        size={width}
        min={140}
        max={520}
        onResize={setWidth}
        aria-label={i18n.buff.t("Resize the sidebar")}
        className="absolute inset-y-0 end-0 z-20"
      />
      <div className="flex size-full min-h-0 flex-col">
        {/* macOS draws its traffic lights here, the native titlebar being hidden: the strip moves the window. */}
        {clearance !== undefined && (
          <div className="mb-4 min-h-7 w-full shrink-0" style={{ height: clearance }} data-drag-region="" />
        )}
        <SidebarAction
          action="vertical-tabs-home"
          icon={House}
          label={i18n.t("home.title")}
          pressed={actions.home}
          keybind="home.toggle"
          onClick={actions.toggleHome}
        />
        {PAGE_ENTRIES.map((page) => (
          <SidebarAction
            key={page.action}
            action={`${page.action}-open`}
            icon={page.icon}
            label={i18n.buff.t(page.title)}
            pressed={route.name === page.route}
            onClick={() => navigate(page.path)}
          />
        ))}
        <SidebarReach />
        <SidebarAction
          action="vertical-tabs-new-session"
          icon={SquarePen}
          label={i18n.t("command.session.new")}
          keybind="tab.new"
          onClick={actions.openNewTab}
        />
        <div className="h-4 w-full shrink-0" aria-hidden="true" />
        <div className="flex max-h-[40%] min-h-0 shrink-0 flex-col gap-1 overflow-y-auto">
          <WindowTabs orientation="vertical" />
        </div>
        {props.sessions}
        {update && (
          <div data-slot="vertical-tabs-footer" className="mt-2 flex w-full shrink-0 flex-col">
            <UpdateButton vertical />
          </div>
        )}
      </div>
    </aside>
  )
}

/** The phone and the settings, always in reach (#704) — at the top beside the pages (#709): at the
 *  foot a long session list pushed them out of the window. */
function SidebarReach() {
  const i18n = useI18n()
  const route = useRoute()
  const surface = useSettingsSurface()
  const tab = useSettingsState((state) => (state.view.type === "project" ? undefined : state.view.tab))
  const open = route.name === "settings"
  return (
    <>
      <SidebarAction
        action="buff-phone-open"
        icon={Smartphone}
        label={i18n.buff.t("Phone")}
        pressed={open && tab === "phone"}
        onClick={() => surface.open("phone")}
      />
      <SidebarAction
        action="buff-settings-open"
        icon={Settings}
        label={i18n.t("sidebar.settings")}
        pressed={open && tab !== "phone"}
        keybind="settings.open"
        onClick={() => surface.open()}
      />
    </>
  )
}

function SidebarAction(props: {
  action: string
  icon: LucideIcon
  label: string
  pressed?: boolean
  keybind?: string
  onClick: () => void
}) {
  const i18n = useI18n()
  const commands = useCommands()
  useStore(commands.changes, (list) => list)
  const keybind = props.keybind ? commands.keybind(props.keybind) : undefined
  const Icon = props.icon
  return (
    <button
      type="button"
      data-titlebar-tab-action
      data-action={props.action}
      data-state={props.pressed ? "pressed" : undefined}
      aria-label={props.label}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed}
      className="group mb-1 flex h-7 w-full shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] leading-4 text-muted-foreground hover:bg-accent hover:text-foreground data-[state=pressed]:text-foreground"
      onClick={props.onClick}
    >
      <Icon aria-hidden data-slot="icon-svg" className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{props.label}</span>
      {keybind && (
        <span
          aria-hidden="true"
          className="ms-auto hidden min-w-0 truncate text-muted-foreground group-hover:block group-focus-visible:block"
        >
          <bdi dir="ltr">{formatKeybind(keybind, (key: KeyLabel) => i18n.t(key))}</bdi>
        </span>
      )}
    </button>
  )
}
