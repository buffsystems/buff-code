// The session screen's frame (#584): the chat panel (header, timeline, overlay, composer), the side
// column — the review over the terminal when it sits «beside» — and the terminal across the bottom,
// each filled from its named slot. The Solid session screen's geometry and motion; see README.md.

import { Panel, ResizeHandle } from "@buff/ui/react"
import { SESSION_PANEL_WIDTH_MIN } from "@opencode/app/react-reuse/session-panel-width"
import { memo, useEffect, useState, type CSSProperties, type ReactNode, type TransitionEvent } from "react"
import { useI18n } from "../i18n/provider"
import { useMediaQuery } from "../shell/media"
import { useSettings } from "../shell/settings-context"
import { useSessionCommands } from "./commands"
import { useSession, useSessionViewNow } from "./context"
import {
  nextGap,
  nextKept,
  nextSideMotion,
  useElementSize,
  useFollow,
  useSizing,
  useViewportHeight,
  type KeptRegions,
  type SideMotion,
} from "./layout-state"
import { KeptSlot, KeptSlotPlace } from "./kept-slot"
import { DefaultHeader, SlotEntries } from "./layout-slots"
import { MobileSession } from "./mobile"
import { useAnimatedPresence } from "./presence"
import { SessionRegionsProvider, useStableRegions, type SessionRegions } from "./regions"
import { useSummaryResizeFreeze } from "../summary/motion"
import { sessionScreenLayout } from "./screen-layout"
import type { SessionSlots } from "./slots"
import { TERMINAL_HEIGHT_MIN } from "./view"
import "./layout.css"

const NO_MOTION: SideMotion = {
  region: false,
  terminal: false,
  animateRegion: false,
  animateTerminal: false,
  initialized: false,
}

export function SessionLayout(props: { slots: SessionSlots }) {
  useSessionCommands()
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <KeptSlot slot={<SlotEntries entries={props.slots.timeline} />}>
      {desktop ? <DesktopLayout slots={props.slots} /> : <MobileSession slots={props.slots} />}
    </KeptSlot>
  )
}

function DesktopLayout(props: { slots: SessionSlots }) {
  const slots = props.slots
  const i18n = useI18n()
  const session = useSession()
  const view = useSessionViewNow()
  const placement = useSettings((settings) => settings.general.terminalPlacement)
  const sizing = useSizing()
  const [rowElement, setRowElement] = useState<HTMLDivElement | null>(null)
  const [sideElement, setSideElement] = useState<HTMLDivElement | null>(null)
  const [bottomElement, setBottomElement] = useState<HTMLDivElement | null>(null)
  const [chatElement, setChatElement] = useState<HTMLDivElement | null>(null)
  useSummaryResizeFreeze(chatElement)
  const row = useElementSize(rowElement)
  const viewportHeight = useViewportHeight()
  const identity = session.viewKey
  const screen = sessionScreenLayout({
    desktop: true,
    review: view.review && slots.side.length > 0,
    terminal: view.terminal && slots.bottom.length > 0,
    placement,
    sessionWidth: view.sessionWidth,
    terminalHeight: view.terminalHeight,
    split: false,
    row,
    viewportHeight,
  })
  const [contentWidth] = useFollow<string>(
    () => screen.contentWidth ?? "100%",
    (current) => screen.contentWidth ?? current,
  )
  const sidePresence = useAnimatedPresence(screen.sideVisible, identity, sideElement)
  const bottomPresence = useAnimatedPresence(screen.bottomTerminal, identity, bottomElement)
  const [kept, setKept] = useFollow<KeptRegions>(
    () => ({ region: false, review: false, sideTerminal: false, bottomTerminal: false }),
    (current) =>
      nextKept(current, {
        desktop: true,
        side: placement === "side",
        review: screen.review,
        sideTerminal: screen.sideTerminal,
        bottomTerminal: screen.bottomTerminal,
      }),
  )
  const [motion] = useFollow(
    () => NO_MOTION,
    (current) => nextSideMotion(current, identity, screen.review, screen.sideTerminal),
  )
  const [gap] = useFollow(
    () => ({ gap: screen.stacked, closing: false }),
    (current) => nextGap(current, screen.stacked),
  )
  const [heightMotion, setHeightMotion] = useFollow(
    () => false,
    (current) => current && screen.sideVisible,
  )
  const [widthMotion, setWidthMotion] = useState(false)
  const [scrollbarHidden, setScrollbarHidden] = useState(false)
  const animating = sidePresence.animate || motion.animateRegion || motion.animateTerminal || bottomPresence.animate
  const heightTransition = !sizing.active && heightMotion && animating
  const terminalRegionsProps = { view, screen, sizing, kept, motion, sidePresence, bottomPresence }
  const reviewValue = useStableRegions(reviewRegions(screen.review, kept.review, screen.stacked, sizing.active))
  const sideTerminalValue = useStableRegions(sideTerminalRegions(terminalRegionsProps))
  const bottomTerminalValue = useStableRegions(bottomTerminalRegions(terminalRegionsProps))

  const trackWidthMotion = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.currentTarget !== event.target || event.propertyName !== "width") return
    setWidthMotion(event.type === "transitionrun")
  }
  // Native listeners: the timeline is a kept slot, so its events bubble here in the DOM, not in React.
  useEffect(() => {
    if (!chatElement || !scrollbarHidden || widthMotion) return
    const reveal = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-slot="session-timeline-scroll"]')) return
      setScrollbarHidden(false)
    }
    const events = ["pointermove", "pointerdown", "wheel", "keydown"] as const
    events.forEach((type) => chatElement.addEventListener(type, reveal, { passive: true }))
    return () => events.forEach((type) => chatElement.removeEventListener(type, reveal))
  }, [chatElement, scrollbarHidden, widthMotion])
  const hideScrollbar = () => setScrollbarHidden(true)

  return (
    <div data-component="session-layout" className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
      <div ref={setRowElement} className="relative flex min-h-0 flex-1 flex-row gap-2">
        {slots["panel-actions"].length > 0 && (
          <div
            data-slot="session-panel-actions"
            className={`absolute end-3 top-0 z-30 flex items-center gap-1 ${screen.sideTerminal ? "h-[51px]" : "h-12"}`}
            onPointerDown={hideScrollbar}
            onClick={hideScrollbar}
          >
            <SlotEntries entries={slots["panel-actions"]} />
          </div>
        )}
        <div
          ref={setChatElement}
          data-slot="session-chat-panel"
          data-motion={!sizing.active && sidePresence.animate ? "width" : undefined}
          data-width-animating={widthMotion}
          data-scrollbar-hidden={scrollbarHidden || widthMotion}
          className="relative z-10 flex h-full min-h-0 min-w-0 shrink-0 flex-col"
          style={{ width: screen.panelWidth }}
          onTransitionRun={trackWidthMotion}
          onTransitionEnd={trackWidthMotion}
          onTransitionCancel={trackWidthMotion}
        >
          <ChatPanel slots={slots} />
          {screen.resizable && (
            <div onPointerDown={sizing.start}>
              <ResizeHandle
                data-component="resize-handle"
                direction="horizontal"
                size={screen.resizedWidth}
                min={SESSION_PANEL_WIDTH_MIN}
                max={screen.panelMax}
                onResize={(width) => {
                  sizing.touch()
                  view.resizeSession(width)
                }}
                aria-label={i18n.buff.t("Resize the side panel")}
                className="absolute inset-y-0 -end-1.5 z-20 w-3"
              />
            </div>
          )}
        </div>
        {(sidePresence.present || kept.review || kept.sideTerminal) && (
          <div
            ref={setSideElement}
            data-slot="session-side-panel-presence"
            data-opened={sidePresence.animate ? sidePresence.show : undefined}
            className={
              sidePresence.present
                ? "relative z-0 h-full min-w-0 flex-1 overflow-visible"
                : "pointer-events-none invisible absolute inset-y-0 end-0 z-0 w-0 overflow-visible"
            }
            onAnimationEnd={(event) => {
              if (event.currentTarget !== event.target) return
              if (event.animationName !== "side-region-presence-in" || !screen.sideVisible) return
              setHeightMotion(true)
            }}
          >
            <div
              data-slot="session-side-panel-content"
              className="absolute inset-y-0 start-0 size-full"
              style={{ "--session-side-content-width": contentWidth } as CSSProperties}
            >
              <div
                data-slot="session-side-region"
                data-motion={heightTransition ? "height" : "none"}
                className="absolute inset-x-0 top-0 min-h-0 overflow-visible"
                style={{ height: screen.sideVisible ? screen.regionHeight : "100%" }}
              >
                {kept.region && (
                  <div
                    data-slot="session-side-region-presence"
                    data-opened={motion.animateRegion ? motion.region : undefined}
                    className="absolute inset-0"
                    onAnimationEnd={(event) => {
                      if (event.currentTarget !== event.target) return
                      if (event.animationName !== "side-region-presence-out") return
                      if (screen.review || screen.sideTerminal) return
                      setKept((current) => ({ ...current, region: false, review: false }))
                    }}
                  >
                    <SessionRegionsProvider value={reviewValue}>
                      <SlotEntries entries={slots.side} />
                    </SessionRegionsProvider>
                  </div>
                )}
              </div>
              <div className="absolute bottom-0 start-0 flex flex-col" style={{ width: contentWidth }}>
                <div
                  data-slot="session-side-panel-gap"
                  data-closing={gap.closing}
                  data-motion={animating ? undefined : "none"}
                  className="relative z-0 shrink-0 overflow-visible"
                  style={{ height: gap.gap ? "8px" : "0px" }}
                  onPointerDown={sizing.start}
                >
                  {screen.stacked && <TerminalResize {...terminalRegionsProps} className="relative size-full" />}
                </div>
                <div
                  data-slot="session-side-terminal-region"
                  data-motion={heightTransition ? "height" : "none"}
                  className="relative z-10 min-h-0 shrink-0 overflow-visible"
                  style={{ height: screen.terminalHeight }}
                >
                  {kept.sideTerminal && (
                    <div
                      data-slot="side-terminal-panel-presence"
                      data-opened={motion.animateTerminal ? motion.terminal : undefined}
                      className="session-side-terminal absolute inset-0"
                    >
                      <div data-slot="side-terminal-panel-clip" className="size-full overflow-clip">
                        <SessionRegionsProvider value={sideTerminalValue}>
                          <SlotEntries entries={slots.bottom} />
                        </SessionRegionsProvider>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {(bottomPresence.present || kept.bottomTerminal) && (
        <div
          ref={setBottomElement}
          data-slot="terminal-panel-presence"
          data-opened={bottomPresence.animate ? bottomPresence.show : undefined}
          className={bottomPresence.present ? "relative min-h-0 shrink-0" : "hidden"}
        >
          <div className="absolute inset-x-0 -top-1 z-10 h-2" onPointerDown={sizing.start}>
            <TerminalResize {...terminalRegionsProps} className="relative size-full" />
          </div>
          <SessionRegionsProvider value={bottomTerminalValue}>
            <SlotEntries entries={slots.bottom} />
          </SessionRegionsProvider>
        </div>
      )}
    </div>
  )
}

const ChatPanel = memo(function ChatPanel(props: { slots: SessionSlots }) {
  const slots = props.slots
  return (
    <Panel className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {slots.header.length > 0 ? <SlotEntries entries={slots.header} /> : <DefaultHeader />}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <KeptSlotPlace />
        <SlotEntries entries={slots["chat-overlay"]} />
      </div>
      <SlotEntries entries={slots.composer} />
    </Panel>
  )
})

type TerminalRegionsInput = {
  view: ReturnType<typeof useSessionViewNow>
  screen: ReturnType<typeof sessionScreenLayout>
  sizing: ReturnType<typeof useSizing>
  kept: KeptRegions
  motion: SideMotion
  sidePresence: { animate: boolean }
  bottomPresence: { animate: boolean }
}

function TerminalResize(props: TerminalRegionsInput & { className: string }): ReactNode {
  const i18n = useI18n()
  return (
    <ResizeHandle
      data-component="resize-handle"
      direction="vertical"
      edge="start"
      size={props.view.terminalHeight}
      min={TERMINAL_HEIGHT_MIN}
      max={props.screen.terminalMax}
      collapseBelow={50}
      onCollapse={props.view.closeTerminal}
      onResize={(height) => {
        props.sizing.touch()
        props.view.resizeTerminal(height)
      }}
      aria-label={i18n.buff.t("Resize the bottom panel")}
      className={props.className}
    />
  )
}

function reviewRegions(opened: boolean, present: boolean, stacked: boolean, resizing: boolean): SessionRegions {
  return {
    review: { opened, present, stacked, resizing },
    terminal: CLOSED_TERMINAL,
  }
}

const CLOSED_TERMINAL: SessionRegions["terminal"] = {
  opened: false,
  present: false,
  desktop: true,
  stacked: false,
  fill: false,
  framed: true,
  height: "0px",
  contentHeight: "100%",
  animate: false,
  resizing: false,
  reserveReviewToggle: false,
}

const NO_REVIEW: SessionRegions["review"] = { opened: false, present: false, stacked: false, resizing: false }

function sideTerminalRegions(input: TerminalRegionsInput): SessionRegions {
  return {
    review: NO_REVIEW,
    terminal: {
      opened: input.view.terminal,
      present: input.kept.sideTerminal,
      desktop: true,
      stacked: false,
      fill: true,
      framed: false,
      height: "100%",
      contentHeight: input.screen.terminalContentHeight,
      animate: input.sidePresence.animate || input.motion.animateTerminal,
      resizing: input.sizing.active,
      reserveReviewToggle: !input.screen.review,
    },
  }
}

function bottomTerminalRegions(input: TerminalRegionsInput): SessionRegions {
  const pane = `${input.screen.terminalPane}px`
  return {
    review: NO_REVIEW,
    terminal: {
      opened: input.view.terminal,
      present: input.kept.bottomTerminal,
      desktop: true,
      stacked: true,
      fill: false,
      framed: true,
      height: input.view.terminal ? pane : "0px",
      contentHeight: pane,
      animate: input.bottomPresence.animate,
      resizing: input.sizing.active,
      reserveReviewToggle: false,
    },
  }
}
