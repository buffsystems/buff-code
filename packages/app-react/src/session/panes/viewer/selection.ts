// Line selection over a Pierre viewer's shadow DOM (#584): the Solid File component's mouse
// state machine (a click selects a line, a drag a range, the number column drags whole lines and
// opens a comment), as a plain controller a React viewer attaches to its container.

import type { SelectedLineRange } from "@pierre/diffs"
import { findDiffSide, type DiffSelectionSide } from "@opencode/session-ui/pierre/diff-selection"
import { findElement, readShadowLineSelection } from "@opencode/session-ui/pierre/file-selection"
import {
  createLineNumberSelectionBridge,
  restoreShadowTextSelection,
} from "@opencode/session-ui/pierre/selection-bridge"

export type MouseHit = { line: number | undefined; numberColumn: boolean; side?: DiffSelectionSide }

export type SelectionMode = {
  lineFromEvent: (event: MouseEvent) => MouseHit
  lineForNode: (node: Node | null) => number | undefined
  sideForNode: (node: Node | null) => SelectedLineRange["side"]
  /** Apply a range to the viewer; returns the range it settled on. */
  apply: (range: SelectedLineRange | null, preserve?: { root: ShadowRoot; text: Range }) => void
  /** Whether a drag tracks diff sides. */
  sided: boolean
}

export type SelectionInput = {
  root: () => ShadowRoot | undefined
  enabled: () => boolean
  mode: SelectionMode
  onSelectionEnd: (range: SelectedLineRange | null) => void
}

export function parseLine(node: HTMLElement) {
  if (!node.dataset.line) return
  const value = parseInt(node.dataset.line, 10)
  if (Number.isNaN(value)) return
  return value
}

export function mouseHit(
  event: MouseEvent,
  line: (node: HTMLElement) => number | undefined,
  side?: (node: HTMLElement) => DiffSelectionSide | undefined,
): MouseHit {
  const hit: MouseHit = { line: undefined, numberColumn: false }
  for (const item of event.composedPath()) {
    if (!(item instanceof HTMLElement)) continue
    hit.numberColumn = hit.numberColumn || item.dataset.columnNumber != null
    if (hit.line === undefined) hit.line = line(item)
    if (hit.side === undefined && side) hit.side = side(item)
    if (hit.numberColumn && hit.line !== undefined && (side == null || hit.side !== undefined)) break
  }
  return hit
}

export function diffMouseSide(node: HTMLElement): DiffSelectionSide | undefined {
  const type = node.dataset.lineType
  if (type === "change-deletion") return "deletions"
  if (type === "change-addition" || type === "change-additions") return "additions"
  if (node.dataset.code == null) return
  return node.hasAttribute("data-deletions") ? "deletions" : "additions"
}

export function diffSelectionSide(node: Node | null) {
  const element = findElement(node)
  if (!element) return
  return findDiffSide(element)
}

const sameRange = (a: SelectedLineRange | null, b: SelectedLineRange) =>
  a?.start === b.start && a.end === b.end && a.side === b.side && (a.endSide ?? a.side) === (b.endSide ?? b.side)

/** The selection controller: `attach` wires its listeners to a viewer container. */
export function createLineSelection(input: SelectionInput) {
  const bridge = createLineNumberSelectionBridge()
  const drag: { start?: number; end?: number; moved: boolean; side?: DiffSelectionSide; endSide?: DiffSelectionSide } = {
    moved: false,
  }
  const frames: { selection?: number; drag?: number } = {}
  const state = { last: null as SelectedLineRange | null, pendingEnd: false }

  const reset = () => {
    drag.start = undefined
    drag.end = undefined
    drag.moved = false
    drag.side = undefined
    drag.endSide = undefined
  }

  const dragRange = (): SelectedLineRange | undefined => {
    if (drag.start === undefined || drag.end === undefined) return
    if (!input.mode.sided) return { start: Math.min(drag.start, drag.end), end: Math.max(drag.start, drag.end) }
    const range: SelectedLineRange = { start: drag.start, end: drag.end }
    if (drag.side) range.side = drag.side
    if (drag.endSide && drag.side && drag.endSide !== drag.side) range.endSide = drag.endSide
    return range
  }

  const clickRange = (): SelectedLineRange | undefined => {
    if (drag.start === undefined) return
    const range: SelectedLineRange = { start: drag.start, end: drag.start }
    if (input.mode.sided && drag.side) range.side = drag.side
    return range
  }

  const updateFromText = (preserve: boolean) => {
    const root = input.root()
    if (!root) return
    const selected = readShadowLineSelection({
      root,
      lineForNode: input.mode.lineForNode,
      sideForNode: input.mode.sideForNode,
      preserveTextSelection: preserve,
    })
    if (!selected) return
    if (input.mode.sided && selected.text) return input.mode.apply(selected.range, { root, text: selected.text })
    input.mode.apply(selected.range)
    if (!input.mode.sided && preserve && selected.text) restoreShadowTextSelection(root, selected.text)
  }

  const scheduleSelection = () => {
    if (frames.selection !== undefined) return
    frames.selection = requestAnimationFrame(() => {
      frames.selection = undefined
      updateFromText(state.pendingEnd)
      if (!state.pendingEnd) return
      state.pendingEnd = false
      input.onSelectionEnd(state.last)
    })
  }

  const scheduleDrag = () => {
    if (frames.drag !== undefined) return
    frames.drag = requestAnimationFrame(() => {
      frames.drag = undefined
      const range = dragRange()
      if (range) input.mode.apply(range)
    })
  }

  const down = (event: MouseEvent) => {
    if (!input.enabled() || event.button !== 0) return
    const hit = input.mode.lineFromEvent(event)
    if (hit.numberColumn) return bridge.begin(true, hit.line)
    if (hit.line === undefined) return
    bridge.begin(false, hit.line)
    drag.start = hit.line
    drag.end = hit.line
    drag.moved = false
    drag.side = hit.side
    drag.endSide = hit.side
  }

  const move = (event: MouseEvent) => {
    if (!input.enabled()) return
    const hit = input.mode.lineFromEvent(event)
    if (bridge.track(event.buttons, hit.line)) return
    if (drag.start === undefined) return
    if ((event.buttons & 1) === 0) {
      reset()
      bridge.finish()
      return
    }
    if (hit.line === undefined) return
    drag.end = hit.line
    drag.moved = true
    drag.endSide = hit.side
    scheduleDrag()
  }

  const up = () => {
    if (!input.enabled()) return
    if (bridge.finish() === "numbers") return
    if (drag.start === undefined) return
    if (!drag.moved) {
      state.pendingEnd = false
      const selected = clickRange()
      const next = selected && sameRange(state.last, selected) ? null : selected
      if (next !== undefined) input.mode.apply(next)
      input.onSelectionEnd(next === undefined ? state.last : next)
      reset()
      return
    }
    state.pendingEnd = true
    scheduleDrag()
    scheduleSelection()
    reset()
  }

  const selectionChange = () => {
    if (!input.enabled() || drag.start === undefined) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    scheduleSelection()
  }

  return {
    bridge,
    get last() {
      return state.last
    },
    set last(range: SelectedLineRange | null) {
      state.last = range
    },
    attach(container: HTMLElement) {
      container.addEventListener("mousedown", down)
      container.addEventListener("mousemove", move)
      window.addEventListener("mouseup", up)
      document.addEventListener("selectionchange", selectionChange)
      return () => {
        container.removeEventListener("mousedown", down)
        container.removeEventListener("mousemove", move)
        window.removeEventListener("mouseup", up)
        document.removeEventListener("selectionchange", selectionChange)
        if (frames.selection !== undefined) cancelAnimationFrame(frames.selection)
        if (frames.drag !== undefined) cancelAnimationFrame(frames.drag)
        frames.selection = undefined
        frames.drag = undefined
        reset()
        bridge.reset()
        state.last = null
        state.pendingEnd = false
      }
    },
  }
}

export type LineSelection = ReturnType<typeof createLineSelection>
