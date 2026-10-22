// The session screen's geometry (#584), the Solid window's createSessionScreenLayout as plain
// functions: the chat panel keeps its stored width beside the side column; in the side column the
// review sits over the terminal (placement «beside»), or the terminal runs across the bottom.

import { clampSessionPanelWidth, sessionPanelWidthMax } from "@opencode/app/react-reuse/session-panel-width"

export type TerminalPlacement = "side" | "bottom"

export type ScreenLayoutInput = {
  desktop: boolean
  review: boolean
  terminal: boolean
  placement: TerminalPlacement
  sessionWidth: number
  terminalHeight: number
  /** The diff shows in two columns: the review needs more room. */
  split: boolean
  /** The panels' row, once measured. */
  row: { width?: number; height?: number }
  viewportHeight: number
}

const GAP = 8

export function sessionScreenLayout(input: ScreenLayoutInput) {
  const review = input.desktop && input.review
  const sideTerminal = input.desktop && input.terminal && input.placement === "side"
  const bottomTerminal = input.desktop && input.terminal && input.placement === "bottom"
  const resizable = review || sideTerminal
  const available = input.row.width === undefined ? undefined : input.row.width - GAP
  const resizedWidth = clampSessionPanelWidth({ width: input.sessionWidth, available, split: input.split })
  const terminalPane = Math.min(input.terminalHeight, input.viewportHeight * 0.6)
  const fullSide = input.row.height === undefined ? "100%" : `${input.row.height}px`
  const stackedReview =
    input.row.height === undefined
      ? `calc(100% - ${terminalPane}px - ${GAP}px)`
      : `${Math.max(0, input.row.height - terminalPane - GAP)}px`
  return {
    review,
    sideTerminal,
    bottomTerminal,
    /** Review and terminal share the side column. */
    stacked: review && sideTerminal,
    sideVisible: resizable,
    resizable,
    resizedWidth,
    panelWidth: resizable ? `${resizedWidth}px` : "100%",
    panelMax: available === undefined ? 1000 : sessionPanelWidthMax({ available, split: input.split }),
    /** The side contents' fixed width while the column slides; undefined keeps the last one. */
    contentWidth: resizable && available !== undefined ? `${Math.max(0, available - resizedWidth)}px` : undefined,
    terminalPane,
    terminalMax: input.viewportHeight * 0.6,
    regionHeight: !review ? "0px" : sideTerminal ? stackedReview : fullSide,
    terminalHeight: !sideTerminal ? "0px" : review ? `${terminalPane}px` : fullSide,
    terminalContentHeight: review ? `${terminalPane}px` : fullSide,
  }
}

export type ScreenLayout = ReturnType<typeof sessionScreenLayout>
