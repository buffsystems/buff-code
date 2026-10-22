// The titlebar (#584): with horizontal tabs it carries Home, Buff's pages, the tab strip and a
// new-tab button; on a phone it is the tab switcher. With vertical tabs it is hidden — the
// sidebar holds all of it — except on Windows, where it keeps the room under the caption buttons
// and the application menu. In the desktop window it moves the window and leaves room for the
// native controls.

import { IconButton } from "@buff/ui/react"
import { House, Plus } from "lucide-react"
import { useI18n } from "../../i18n/provider"
import { useNavigate, useRoute } from "../../router/router"
import { useShellActions } from "../actions"
import { PAGE_ENTRIES } from "../page-entries"
import { WindowTabs } from "../tabs/tab-strip"
import { UpdateButton } from "../updates/update-button"
import { AppMenu } from "./app-menu"
import { titlebarStyle, useDesktopChrome } from "./chrome"
import { MobileTabs } from "./mobile-tabs"
import { TitlebarRightMount } from "./right-slot"

export function Titlebar(props: { mobile: boolean; vertical: boolean; bottom?: boolean }) {
  const i18n = useI18n()
  const navigate = useNavigate()
  const route = useRoute()
  const actions = useShellActions()
  const chrome = useDesktopChrome()
  // The vertical sidebar carries all of it; a hidden titlebar must not keep a second tab strip.
  if (props.vertical && !chrome.windows) return <header data-slot="titlebar-v2" hidden />
  const menu = (chrome.windows || chrome.linux) && !props.mobile
  return (
    <header
      data-slot="titlebar-v2"
      data-drag-region={chrome.desktop ? "" : undefined}
      className={`relative flex h-9 shrink-0 flex-row overflow-visible ${props.bottom ? "order-last" : ""}`}
      style={titlebarStyle(chrome)}
    >
      <div
        className={`flex h-full flex-1 flex-row items-center gap-1.5 overflow-hidden px-2 md:pe-3 ${chrome.mac && !chrome.fullscreen ? "pl-4" : ""} ${chrome.windows ? "ps-3.5" : ""}`}
      >
        {menu && <AppMenu />}
        {props.mobile ? (
          <MobileTabs />
        ) : props.vertical ? null : (
          <>
            <IconButton
              icon={House}
              size="sm"
              aria-label={i18n.t("home.title")}
              aria-pressed={actions.home}
              data-state={actions.home ? "pressed" : undefined}
              onClick={actions.toggleHome}
            />
            {PAGE_ENTRIES.map((page) => (
              <IconButton
                key={page.action}
                icon={page.icon}
                size="sm"
                data-action={`${page.action}-open`}
                aria-label={i18n.buff.t(page.title)}
                data-state={route.name === page.route ? "pressed" : undefined}
                onClick={() => navigate(page.path)}
              />
            ))}
            <WindowTabs orientation="horizontal" />
            <IconButton icon={Plus} size="sm" aria-label={i18n.t("command.session.new")} onClick={actions.openNewTab} />
            <div className="flex-1" />
            <div className="relative z-20 flex shrink-0 items-center justify-end">
              <UpdateButton />
              <TitlebarRightMount />
            </div>
          </>
        )}
      </div>
    </header>
  )
}
