// The window's frame (#584): the titlebar or the vertical sidebar around the routed screen, the
// toasts, and the debug bar on demand. Mirrors the Solid window's shell layout.

import "./shell.css"
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react"
import { preloadDraftSlots } from "../new-session/slots"
import { preloadSessionSlots } from "../session/registered"
import { warmMarkdownWorker } from "@opencode/session-ui/markdown-worker"
import { useShellCommands } from "./actions"
import { useMobile } from "./media"
import { usePaletteSources } from "./palette"
import { useTranscriptSearchCommand } from "./sessions/transcript-search"
import { useSessionsServer } from "./sessions/session-list"
import { AppMounts } from "./mounts"
import { useReadFailureToasts } from "./notifications/read-failures"
import { ToastRegion } from "./notifications/toast-region"
import { VerticalSidebar } from "./sidebar"
import { TabRouteSync } from "./tabs/provider"
import { Titlebar } from "./titlebar/titlebar"
import { TitlebarRightProvider } from "./titlebar/right-slot"

const DebugBar = lazy(() => import("./debug/debug-bar").then((module) => ({ default: module.DebugBar })))

export type TabLayout = "horizontal" | "vertical"

// The session and draft screens' lazy slots load once the window is idle (#584), so a session or
// the new session page opened from elsewhere paints at once rather than an empty layout. The
// markdown worker starts then too: its module, the highlighter's wasm and theme were on the path
// of a cold session's first text, after the click.
function useIdlePreload() {
  useEffect(() => {
    const state: { handle?: number; timer?: ReturnType<typeof setTimeout> } = {}
    const idle = (run: () => void, timeout: number) => {
      if (typeof requestIdleCallback !== "function") return void (state.timer = setTimeout(run, timeout / 2))
      state.handle = requestIdleCallback(run, { timeout })
    }
    // The worker's wasm compiles on another core; it waits for the next idle moment after the slots,
    // so a busy first screen (a long Home) is not competing with it.
    idle(() => {
      preloadSessionSlots()
      preloadDraftSlots()
      idle(warmMarkdownWorker, 3_000)
    }, 2_000)
    return () => {
      if (state.handle !== undefined) cancelIdleCallback(state.handle)
      clearTimeout(state.timer)
    }
  }, [])
}

export function Shell(props: { tabLayout?: TabLayout; sessions?: ReactNode; children?: ReactNode }) {
  return (
    <TitlebarRightProvider>
      <ShellFrame {...props} />
    </TitlebarRightProvider>
  )
}

function ShellFrame(props: { tabLayout?: TabLayout; sessions?: ReactNode; children?: ReactNode }) {
  const mobile = useMobile()
  const [debug, setDebug] = useState(false)
  // The menu's «Toggle sidebar» folds the vertical tabs into the titlebar and back, for this window's life.
  const [folded, setFolded] = useState(false)
  const sidebar = (props.tabLayout ?? "vertical") === "vertical" && !mobile
  useShellCommands({
    onToggleDebug: () => setDebug((value) => !value),
    onToggleSidebar: sidebar ? () => setFolded((value) => !value) : undefined,
  })
  usePaletteSources()
  useTranscriptSearchCommand(useSessionsServer())
  useReadFailureToasts()
  useIdlePreload()
  const vertical = sidebar && !folded
  return (
    <div
      data-component="shell"
      className="relative flex min-h-0 min-w-0 flex-1 select-none flex-col [&_[contenteditable]]:select-text [&_input]:select-text [&_textarea]:select-text"
    >
      <TabRouteSync />
      <Titlebar mobile={mobile} vertical={vertical} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-row">
        {vertical && <VerticalSidebar sessions={props.sessions} />}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch overflow-x-hidden">{props.children}</main>
      </div>
      {debug && (
        <Suspense>
          <DebugBar />
        </Suspense>
      )}
      <ToastRegion />
      <AppMounts />
    </div>
  )
}
