// A pane's scroller on both axes (#584), the Solid ScrollView with orientation "both": native
// scrolling under overlay thumbs that show while hovered, scrolled or dragged, the horizontal one
// following a right-to-left viewport (whose scrollLeft runs negative). The review's file tree uses
// it so long names scroll sideways.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { useI18n } from "../../i18n/provider"

type Axis = "vertical" | "horizontal"
type Thumb = { show: boolean; size: number; start: number }

const PADDING = 8
const MIN_THUMB = 32
const hidden: Thumb = { show: false, size: 0, start: 0 }

/** The scroll offset a thumb dragged to `pointer` stands for (the Solid scrollOffsetFromThumbPointer). */
export function offsetFromThumb(input: {
  pointer: number
  trackStart: number
  grab: number
  clientSize: number
  scrollSize: number
  thumbSize: number
  reverse?: boolean
}) {
  const maxStart = input.clientSize - PADDING * 2 - input.thumbSize
  if (maxStart <= 0) return 0
  const start = Math.max(0, Math.min(input.pointer - input.trackStart - PADDING - input.grab, maxStart))
  const progress = input.reverse ? 1 - start / maxStart : start / maxStart
  return progress * Math.max(0, input.scrollSize - input.clientSize)
}

/** Where each thumb sits for the viewport's current scroll. */
export function measureThumbs(viewport: {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
  clientWidth: number
  scrollWidth: number
  scrollLeft: number
  rtl: boolean
}): Record<Axis, Thumb> {
  const axis = (client: number, scroll: number, offset: number, reverse: boolean): Thumb => {
    const track = Math.max(0, client - PADDING * 2)
    const size = track ? Math.min(track, Math.max((client / scroll) * track, MIN_THUMB)) : 0
    const max = scroll - client
    if (max <= 0) return hidden
    const start = (Math.max(0, Math.min(offset, max)) / max) * (track - size)
    return { show: true, size, start: PADDING + (reverse ? track - size - start : start) }
  }
  return {
    vertical: axis(viewport.clientHeight, viewport.scrollHeight, viewport.scrollTop, false),
    horizontal: axis(
      viewport.clientWidth,
      viewport.scrollWidth,
      viewport.rtl ? -viewport.scrollLeft : viewport.scrollLeft,
      viewport.rtl,
    ),
  }
}

export function PaneScrollView(props: { className?: string; "data-slot"?: string; children?: ReactNode }) {
  const i18n = useI18n()
  const viewport = useRef<HTMLDivElement>(null)
  const [thumbs, setThumbs] = useState<Record<Axis, Thumb>>({ vertical: hidden, horizontal: hidden })
  const [hovered, setHovered] = useState(false)
  const [scrolling, setScrolling] = useState(false)
  const [dragging, setDragging] = useState<Axis>()
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)

  const measure = () => {
    const element = viewport.current
    if (!element) return
    setThumbs(
      measureThumbs({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        scrollLeft: element.scrollLeft,
        rtl: getComputedStyle(element).direction === "rtl",
      }),
    )
  }
  const markScrolling = () => {
    setScrolling(true)
    clearTimeout(idle.current)
    idle.current = setTimeout(() => setScrolling(false), 800)
  }

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    if (element.firstElementChild) resize.observe(element.firstElementChild)
    // Rows widen the content without resizing the viewport; a direction change moves the thumb.
    const mutation = new MutationObserver(measure)
    mutation.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["dir", "style"] })
    return () => {
      resize.disconnect()
      mutation.disconnect()
      clearTimeout(idle.current)
    }
  }, [])

  const drag = (axis: Axis, event: ReactPointerEvent<HTMLDivElement>) => {
    const element = viewport.current
    if (!element) return
    event.preventDefault()
    event.stopPropagation()
    const thumb = event.currentTarget
    const box = thumb.getBoundingClientRect()
    const grab = axis === "vertical" ? event.clientY - box.top : event.clientX - box.left
    const size = thumbs[axis].size
    thumb.setPointerCapture(event.pointerId)
    setDragging(axis)
    const move = (moved: PointerEvent) => {
      const track = element.getBoundingClientRect()
      if (axis === "vertical") {
        element.scrollTop = offsetFromThumb({
          pointer: moved.clientY,
          trackStart: track.top,
          grab,
          clientSize: element.clientHeight,
          scrollSize: element.scrollHeight,
          thumbSize: size,
        })
        return
      }
      const rtl = getComputedStyle(element).direction === "rtl"
      const offset = offsetFromThumb({
        pointer: moved.clientX,
        trackStart: track.left,
        grab,
        clientSize: element.clientWidth,
        scrollSize: element.scrollWidth,
        thumbSize: size,
        reverse: rtl,
      })
      element.scrollLeft = rtl ? -offset : offset
    }
    const done = (ended: PointerEvent) => {
      setDragging(undefined)
      thumb.releasePointerCapture(ended.pointerId)
      thumb.removeEventListener("pointermove", move)
      thumb.removeEventListener("pointerup", done)
      thumb.removeEventListener("pointercancel", done)
    }
    thumb.addEventListener("pointermove", move)
    thumb.addEventListener("pointerup", done)
    thumb.addEventListener("pointercancel", done)
  }

  const visible = !!dragging || scrolling || hovered
  return (
    <div
      className={`scroll-view ${props.className ?? ""}`}
      data-orientation="both"
      data-slot={props["data-slot"]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        ref={viewport}
        className="scroll-view__viewport"
        data-scrollable=""
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
        onScroll={() => {
          measure()
          markScrolling()
        }}
        onWheel={markScrolling}
      >
        {props.children}
      </div>
      {(["vertical", "horizontal"] as const).map(
        (axis) =>
          thumbs[axis].show && (
            <div
              key={axis}
              className="scroll-view__thumb"
              data-orientation={axis}
              data-visible={visible}
              data-dragging={dragging === axis}
              style={
                axis === "vertical"
                  ? { height: thumbs[axis].size, transform: `translateY(${thumbs[axis].start}px)` }
                  : { width: thumbs[axis].size, transform: `translateX(${thumbs[axis].start}px)` }
              }
              onPointerDown={(event) => drag(axis, event)}
            />
          ),
      )}
    </div>
  )
}
