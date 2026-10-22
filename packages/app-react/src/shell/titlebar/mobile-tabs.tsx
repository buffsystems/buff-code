// The phone's tab switcher (#584): the titlebar shows the current tab and the count; a sheet lists
// the tabs with a new session, Home, settings and help.

import { BuffLinks } from "@opencode/schema/buff-links"
import { CircleHelp, House, Plus, Settings, SquarePen } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { sessionTabTitle } from "@opencode/app/react-reuse/tab-title"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useStore } from "../../react/use-store"
import { useNavigate } from "../../router/router"
import { useShellActions } from "../actions"
import { Drawer } from "../drawer"
import { useServerDataByKey } from "../server-data"
import { SessionProgress } from "../project-avatar"
import { sessionActivity } from "../tabs/activity"
import { useTabList, useTabs } from "../tabs/provider"
import { WindowTabs } from "../tabs/tab-strip"
import { tabKey, type Tab } from "../tabs/tabs"

export function MobileTabs() {
  const i18n = useI18n()
  const platform = usePlatform()
  const navigate = useNavigate()
  const actions = useShellActions()
  const list = useTabList()
  const [open, setOpen] = useState(false)
  // The sheet belongs to the phone layout: a window resized out of it (or back) starts closed.
  useEffect(() => {
    if (!open) return
    const query = window.matchMedia("(max-width: 767px)")
    const shut = () => setOpen(false)
    query.addEventListener("change", shut)
    return () => query.removeEventListener("change", shut)
  }, [open])
  const close = (then?: () => void) => {
    setOpen(false)
    then?.()
  }
  return (
    <>
      <button
        type="button"
        data-slot="mobile-tabs-trigger"
        aria-label={i18n.t("titlebar.tabs")}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[13px] leading-4"
        onClick={() => setOpen(true)}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <CurrentIcon tab={actions.current} />
        </span>
        <span data-slot="mobile-tab-title" dir="auto" className="min-w-0 flex-1 truncate text-start">
          <CurrentTitle tab={actions.current} />
        </span>
        <span className="shrink-0 text-muted-foreground">{list.length}</span>
      </button>
      <Drawer open={open} onOpenChange={setOpen} label={i18n.t("titlebar.tabs")}>
        <div data-slot="mobile-tabs-drawer" className="flex min-h-0 flex-col gap-2 px-3 pb-3">
          <div data-slot="mobile-tabs-drawer-list" className="min-h-0 overflow-y-auto">
            <WindowTabs orientation="vertical" onNavigate={() => setOpen(false)} />
          </div>
          <DrawerButton action="mobile-tabs-new-session" onClick={() => close(actions.openNewTab)}>
            <Plus aria-hidden className="size-4" />
            {i18n.t("command.session.new")}
          </DrawerButton>
          <div className="flex shrink-0 flex-col gap-1 border-t pt-2">
            <DrawerButton
              action="mobile-tabs-home"
              current={actions.home}
              onClick={() => close(() => !actions.home && actions.toggleHome())}
            >
              <House aria-hidden className="size-4" />
              {i18n.t("home.title")}
            </DrawerButton>
            <div className="flex items-center gap-1">
              <DrawerButton action="mobile-tabs-settings" grow onClick={() => close(() => navigate("/settings"))}>
                <Settings aria-hidden className="size-4" />
                {i18n.t("sidebar.settings")}
              </DrawerButton>
              <DrawerButton
                action="mobile-tabs-help"
                onClick={() => close(() => platform.openExternal(BuffLinks.docs))}
              >
                <CircleHelp aria-hidden className="size-4" />
                {i18n.t("sidebar.help")}
              </DrawerButton>
            </div>
          </div>
        </div>
      </Drawer>
    </>
  )
}

function DrawerButton(props: {
  action: string
  current?: boolean
  grow?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-action={props.action}
      data-state={props.current ? "pressed" : undefined}
      aria-current={props.current ? "page" : undefined}
      className={`flex h-7 items-center gap-2 rounded-md px-2 text-[13px] leading-4 hover:bg-accent ${props.grow ? "min-w-0 flex-1" : "shrink-0"}`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/** The current tab's mark: the working indicator while its session works or is being prepared. */
function CurrentIcon(props: { tab: Tab | undefined }) {
  const tabs = useTabs()
  const tab = props.tab
  const pending = useStore(tabs.pending, (all) => (tab ? !!all[tabKey(tab)] : false))
  const working = useServerDataByKey(tab?.type === "session" ? tab.server : undefined, (state) =>
    tab?.type === "session" ? sessionActivity(state, tab.sessionId).working : false,
  )
  if (!tab) return <House aria-hidden className="size-4" />
  if (pending || working) return <SessionProgress />
  return <SquarePen aria-hidden className="size-4" />
}

function CurrentTitle(props: { tab: Tab | undefined }) {
  const i18n = useI18n()
  const tabs = useTabs()
  const tab = props.tab
  const stored = useStore(tabs.info, (info) => (tab ? info[tabKey(tab)]?.title : undefined))
  const live = useServerDataByKey(tab?.type === "session" ? tab.server : undefined, (state) =>
    tab?.type === "session" ? state.session.info[tab.sessionId]?.title : undefined,
  )
  if (!tab) return <>{i18n.t("home.title")}</>
  if (tab.type === "draft") return <>{i18n.t("session.tab.session")}</>
  return <>{sessionTabTitle(live ?? stored, i18n.t("session.tab.session"))}</>
}
