// The session on a phone (#584): one panel, and the «Session view» switcher over it — Session,
// Changes, Files, Terminal, with Usage and «Session details» in its menu — the Solid
// SessionMobileViewTabs. The terminal once shown stays mounted while another view shows; opening
// it is the tab's terminal pane.

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton } from "@buff/ui/react"
import { Menu } from "lucide-react"
import { createContext, use, useRef, useState } from "react"
import { useI18n } from "../i18n/provider"
import { useServerData } from "../react/core"
import { useSettings } from "../shell/settings-context"
import { SummaryDrawer } from "../summary/mobile-drawer"
import { useSession, useSessionViewNow } from "./context"
import { KeptSlotPlace } from "./kept-slot"
import { useFollow } from "./layout-state"
import { SlotEntries } from "./layout-slots"
import { SessionRegionsProvider, type SessionRegions } from "./regions"
import type { SessionSlots } from "./slots"

export type MobileView = "session" | "changes" | "files" | "usage" | "terminal"
type MobileTab = Exclude<MobileView, "terminal">

const MobileViewContext = createContext<{ view: MobileView; select: (view: MobileView) => void } | undefined>(undefined)

/** On a phone: the shown view and a way to switch it (the panes open Files from Changes). */
export function useMobileView() {
  return use(MobileViewContext)
}

const TABS = ["session", "changes", "files", "terminal"] as const

export function MobileSession(props: { slots: SessionSlots }) {
  const slots = props.slots
  const session = useSession()
  const view = useSessionViewNow()
  const bottomBar = useSettings((settings) => settings.general.mobileTitlebarPosition === "bottom")
  const [tab, setTab] = useFollow<{ key: string; tab: MobileTab }>(
    () => ({ key: session.sessionID, tab: "session" }),
    (current) => (current.key === session.sessionID ? current : { key: session.sessionID, tab: "session" }),
  )
  const terminal = view.terminal && slots.bottom.length > 0
  const current: MobileView = terminal ? "terminal" : tab.tab
  const [terminalKept, setTerminalKept] = useState(false)
  if (terminal && !terminalKept) setTerminalKept(true)
  const select = (next: MobileView) => {
    if (next === "terminal") return view.openTerminal()
    setTab({ key: session.sessionID, tab: next })
    view.closeTerminal()
  }

  return (
    <MobileViewContext value={{ view: current, select }}>
      {/* The Solid SessionRouteFrame (padded) and SessionPanelFrame: an 8px gutter, less the safe
          area on the titlebar's far side, around one rounded panel. */}
      <div
        data-component="session-layout"
        data-mobile
        className="flex min-h-0 min-w-0 flex-1 flex-col px-2"
        style={{
          paddingTop: bottomBar ? "max(0px, calc(8px - env(safe-area-inset-top, 0px)))" : 8,
          paddingBottom: bottomBar ? 8 : "max(0px, calc(8px - env(safe-area-inset-bottom, 0px)))",
        }}
      >
        <div className="hidden">
          <SlotEntries entries={slots["panel-actions"]} />
        </div>
        <div
          data-slot="session-chat-panel"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-background"
        >
          <MobileViewTabs current={current} onSelect={select} />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {terminalKept && (
              <div className={`absolute inset-0 ${current === "terminal" ? "" : "invisible"}`}>
                <SessionRegionsProvider value={embeddedTerminal(terminal)}>
                  <SlotEntries entries={slots.bottom} />
                </SessionRegionsProvider>
              </div>
            )}
            {current === "session" && (
              <div className="flex size-full flex-col">
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <KeptSlotPlace />
                  <SlotEntries entries={slots["chat-overlay"]} />
                </div>
                <SlotEntries entries={slots.composer} />
              </div>
            )}
            {current === "changes" && <SlotEntries entries={slots["mobile-changes"]} />}
            {current === "files" && <SlotEntries entries={slots["mobile-files"]} />}
            {current === "usage" && <SlotEntries entries={slots["mobile-usage"]} />}
          </div>
        </div>
      </div>
    </MobileViewContext>
  )
}

function MobileViewTabs(props: { current: MobileView; onSelect: (view: MobileView) => void }) {
  const i18n = useI18n()
  const { server, sessionID } = useSession()
  // «Session details» of a root session with a project, opened once the menu has handed the focus
  // back to its button, so closing the sheet returns it there.
  const details = useServerData(server, (state) => {
    const info = state.session.info[sessionID]
    return !!info && !info.parentID && !!info.projectID && !!state.project.info[info.projectID]
  })
  const [summary, setSummary] = useState({ open: false, pending: false })
  const more = useRef<HTMLButtonElement>(null)
  const label = (view: (typeof TABS)[number]) => {
    if (view === "session") return i18n.t("session.tab.session")
    if (view === "changes") return i18n.plural("session.review.change", 0)
    if (view === "files") return i18n.t("session.tab.files")
    return i18n.t("terminal.title")
  }
  return (
    <div data-slot="session-mobile-view-navigation" className="session-mobile-tabs">
      <div role="tablist" aria-label={i18n.t("session.view.select")} className="session-mobile-tabs__list">
        {TABS.map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={props.current === view}
            data-selected={props.current === view || undefined}
            className="session-mobile-tabs__tab"
            onClick={() => props.onSelect(view)}
          >
            {label(view)}
          </button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            ref={more}
            icon={Menu}
            size="sm"
            aria-label={i18n.t("common.moreOptions")}
            data-pressed={props.current === "usage" || undefined}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={() => {
            if (summary.pending) setSummary({ open: true, pending: false })
          }}
        >
          <DropdownMenuItem onSelect={() => props.onSelect("usage")}>{i18n.t("session.tab.usage")}</DropdownMenuItem>
          {details && (
            <DropdownMenuItem onSelect={() => setSummary({ open: false, pending: true })}>
              {i18n.t("session.summary.title")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {details && (
        <SummaryDrawer
          server={server}
          sessionID={sessionID}
          open={summary.open}
          onOpenChange={(open) => setSummary({ open, pending: false })}
          returnFocus={() => more.current}
          onReview={() => {
            setSummary({ open: false, pending: false })
            props.onSelect("changes")
          }}
        />
      )}
    </div>
  )
}

function embeddedTerminal(opened: boolean): SessionRegions {
  return {
    review: { opened: false, present: false, stacked: false, resizing: false },
    terminal: {
      opened,
      present: true,
      desktop: false,
      stacked: true,
      fill: true,
      framed: false,
      height: "100%",
      contentHeight: "100%",
      animate: false,
      resizing: false,
      reserveReviewToggle: false,
    },
  }
}
