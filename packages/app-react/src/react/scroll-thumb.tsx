// A thin overlay scrollbar (#584), like the Solid window's ScrollView: the native bar is hidden, a
// thumb shows while its region is hovered or scrolled and can be dragged without taking focus from
// the field being typed in. Used where @buff/ui's ScrollArea cannot wrap the viewport: the settings
// search's results and the composer's field. `padding` keeps the thumb off the track's ends.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react"

type Thumb = { top: number; height: number; scrollable: boolean }

export function ScrollThumb(props: { viewport: RefObject<HTMLDivElement | null>; hovered: boolean; padding?: number }) {
  const padding = props.padding ?? 0
  const [thumb, setThumb] = useState<Thumb>({ top: 0, height: 0, scrollable: false })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ y: number; scrollTop: number } | undefined>(undefined)

  useEffect(() => {
    const viewport = props.viewport.current
    if (!viewport) return
    const measure = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport
      const scrollable = scrollHeight - clientHeight > 1
      const track = Math.max(0, clientHeight - padding * 2)
      const height = scrollable ? Math.min(track, Math.max(24, (clientHeight / scrollHeight) * track)) : 0
      const top = scrollable ? padding + (scrollTop / (scrollHeight - clientHeight)) * (track - height) : 0
      setThumb((current) =>
        current.top === top && current.height === height && current.scrollable === scrollable
          ? current
          : { top, height, scrollable },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    Array.from(viewport.children).forEach((child) => observer.observe(child))
    viewport.addEventListener("scroll", measure, { passive: true })
    return () => {
      observer.disconnect()
      viewport.removeEventListener("scroll", measure)
    }
  }, [props.viewport, padding])

  if (!thumb.scrollable) return null
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = props.viewport.current
    const start = drag.current
    if (!viewport || !start) return
    const travel = viewport.clientHeight - padding * 2 - thumb.height
    const ratio = (viewport.scrollHeight - viewport.clientHeight) / Math.max(1, travel)
    viewport.scrollTop = start.scrollTop + (event.clientY - start.y) * ratio
  }
  return (
    <div
      className="scroll-view__thumb"
      data-orientation="vertical"
      data-visible={props.hovered || dragging}
      data-dragging={dragging}
      style={{ transform: `translateY(${thumb.top}px)`, height: thumb.height }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { y: event.clientY, scrollTop: props.viewport.current?.scrollTop ?? 0 }
        setDragging(true)
      }}
      onPointerMove={move}
      onPointerUp={() => {
        drag.current = undefined
        setDragging(false)
      }}
    />
  )
}
