import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { useI18n } from "../../i18n/provider"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "./scroll-keys"

type Thumb = { size: number; start: number; show: boolean }

/**
 * The timeline's scroller (#584), as the Solid ScrollView it replaces: a focusable region with
 * keyboard paging and an overlay thumb that also accounts for a virtualized list's pending
 * offset correction. Scroll, wheel, touch and pointer events reach the viewport's handlers.
 */
export function ScrollView(props: {
  className?: string
  style?: CSSProperties
  viewportRef: (element: HTMLDivElement | null) => void
  /** Reconcile native scroll geometry before keyboard or scrollbar navigation reads it. */
  onBeforeScroll?: () => void
  /** Offset/extent correction for a virtualized vertical scrollbar. */
  verticalScrollAdjustment?: number
  onScroll?: (event: Event) => void
  onWheel?: (event: WheelEvent) => void
  onTouchStart?: (event: TouchEvent) => void
  onPointerDown?: (event: PointerEvent) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onClick?: (event: MouseEvent) => void
  children?: ReactNode
  "data-slot"?: string
}) {
  const i18n = useI18n()
  const viewport = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const adjustment = useRef(props.verticalScrollAdjustment ?? 0)
  adjustment.current = props.verticalScrollAdjustment ?? 0
  const handlers = useRef(props)
  handlers.current = props
  const [thumb, setThumb] = useState<Thumb>({ size: 0, start: 0, show: false })
  const [scrolling, setScrolling] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)

  const updateThumb = () => {
    const element = viewport.current
    if (!element) return
    const padding = 8
    const scrollHeight = element.scrollHeight + adjustment.current
    const track = Math.max(0, element.clientHeight - padding * 2)
    const size = track ? Math.min(track, Math.max((element.clientHeight / scrollHeight) * track, 32)) : 0
    const max = scrollHeight - element.clientHeight
    const next = {
      size,
      start: padding + (max > 0 ? ((element.scrollTop + adjustment.current) / max) * (track - size) : 0),
      show: max > 0,
    }
    setThumb((current) =>
      current.size === next.size && current.start === next.start && current.show === next.show ? current : next,
    )
  }
  const update = useRef(updateThumb)
  update.current = updateThumb

  // The viewport's native listeners: React's synthetic wheel and touch listeners are passive at
  // the root, and the virtualizer needs the native events with their real current target.
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const idle = { timer: undefined as ReturnType<typeof setTimeout> | undefined }
    const markScrolling = () => {
      setScrolling(true)
      clearTimeout(idle.timer)
      idle.timer = setTimeout(() => setScrolling(false), 800)
    }
    const onScroll = (event: Event) => {
      update.current()
      markScrolling()
      handlers.current.onScroll?.(event)
    }
    const onWheel = (event: WheelEvent) => {
      markScrolling()
      handlers.current.onWheel?.(event)
    }
    const onTouchStart = (event: TouchEvent) => handlers.current.onTouchStart?.(event)
    const onPointerDown = (event: PointerEvent) => handlers.current.onPointerDown?.(event)
    const onClick = (event: MouseEvent) => handlers.current.onClick?.(event)
    const onKeyDown = (event: KeyboardEvent) => {
      navigate(event)
      handlers.current.onKeyDown?.(event)
    }
    const navigate = (event: KeyboardEvent) => {
      const active = document.activeElement
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return
      const next = scrollKey(event)
      // Modified navigation (for example Ctrl+Home) stays native, but must read the same
      // reconciled geometry as the keys handled here.
      const intent =
        next ??
        scrollKey({ key: event.key, shiftKey: event.key === " " && event.shiftKey, altKey: false, ctrlKey: false, metaKey: false })
      if (!intent || !isScrollKeyTarget(event.target, intent)) return
      // A control that answers arrows itself (a menu button over the transcript, the header's
      // project menu) keeps them: this native listener runs before React's own handlers, and its
      // preventDefault would stop the menu from opening.
      if (event.target instanceof Element && event.target.closest('[aria-haspopup], [role="menu"], [role="listbox"]'))
        return
      if (scrollKeyOwner(element, event.target, intent) !== element) return
      handlers.current.onBeforeScroll?.()
      update.current()
      if (!next) return
      const page = element.clientHeight * 0.8
      const moves: Record<NonNullable<ReturnType<typeof scrollKey>>, () => void> = {
        "page-down": () => element.scrollBy({ top: page, behavior: "smooth" }),
        "page-up": () => element.scrollBy({ top: -page, behavior: "smooth" }),
        home: () => element.scrollTo({ top: 0, behavior: "smooth" }),
        end: () => element.scrollTo({ top: element.scrollHeight, behavior: "smooth" }),
        up: () => element.scrollBy({ top: -40, behavior: "smooth" }),
        down: () => element.scrollBy({ top: 40, behavior: "smooth" }),
      }
      event.preventDefault()
      moves[next]()
    }
    element.addEventListener("scroll", onScroll, { passive: true })
    element.addEventListener("wheel", onWheel, { passive: true })
    element.addEventListener("touchstart", onTouchStart, { passive: true })
    element.addEventListener("pointerdown", onPointerDown)
    element.addEventListener("click", onClick)
    element.addEventListener("keydown", onKeyDown)
    // The observer reports every target once when it starts, after layout.
    const observer = new ResizeObserver(() => update.current())
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => {
      clearTimeout(idle.timer)
      observer.disconnect()
      element.removeEventListener("scroll", onScroll)
      element.removeEventListener("wheel", onWheel)
      element.removeEventListener("touchstart", onTouchStart)
      element.removeEventListener("pointerdown", onPointerDown)
      element.removeEventListener("click", onClick)
      element.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  useEffect(() => {
    update.current()
  }, [props.verticalScrollAdjustment])

  const onThumbPointerDown = (event: PointerEvent) => {
    const element = viewport.current
    const handle = thumbRef.current
    if (!element || !handle) return
    event.preventDefault()
    event.stopPropagation()
    handlers.current.onBeforeScroll?.()
    setDragging(true)
    const grab = event.clientY - handle.getBoundingClientRect().top
    handle.setPointerCapture(event.pointerId)
    const move = (moved: PointerEvent) => {
      handlers.current.onBeforeScroll?.()
      const padding = 8
      const maxStart = element.clientHeight - padding * 2 - thumb.size
      if (maxStart <= 0) return
      const start = Math.max(
        0,
        Math.min(moved.clientY - element.getBoundingClientRect().top - padding - grab, maxStart),
      )
      element.scrollTop = (start / maxStart) * Math.max(0, element.scrollHeight - element.clientHeight)
    }
    const done = (ended: PointerEvent) => {
      setDragging(false)
      handle.releasePointerCapture(ended.pointerId)
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", done)
      handle.removeEventListener("pointercancel", done)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", done)
    handle.addEventListener("pointercancel", done)
  }

  return (
    <div
      className={`scroll-view ${props.className ?? ""}`}
      data-orientation="vertical"
      data-slot={props["data-slot"]}
      style={props.style}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        ref={(element) => {
          viewport.current = element
          props.viewportRef(element)
        }}
        className="scroll-view__viewport"
        data-scrollable=""
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
      >
        {props.children}
      </div>
      {thumb.show && (
        <div
          ref={thumbRef}
          className="scroll-view__thumb"
          data-orientation="vertical"
          data-visible={dragging || scrolling || hovered}
          data-dragging={dragging}
          style={{ height: `${thumb.size}px`, transform: `translateY(${thumb.start}px)` }}
          onPointerDown={(event) => onThumbPointerDown(event.nativeEvent)}
        />
      )}
    </div>
  )
}
