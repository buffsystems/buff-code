// A context menu at the pointer (#584): right click or the menu key (Shift+F10) on a trigger opens
// the design system's menu where it was asked for; closing returns focus to the trigger. @buff/ui
// has a dropdown menu only, so this anchors it to an invisible point.

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@buff/ui/react"
import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"

const LONG_PRESS = 500

export type ContextMenuTrigger = {
  onContextMenu: (event: MouseEvent<HTMLElement>) => void
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerMove: (event: PointerEvent<HTMLElement>) => void
  "aria-haspopup": "menu"
  "aria-expanded": boolean
}

export function ContextMenu(props: {
  children: (trigger: ContextMenuTrigger) => ReactNode
  content: ReactNode
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  /** Called after the menu closed and focus went back; return true to keep focus elsewhere. */
  onClosed?: () => boolean | void
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | undefined>(undefined)
  const trigger = useRef<HTMLElement | null>(null)
  const change = (open: boolean) => {
    if (!open) setPoint(undefined)
    props.onOpenChange?.(open)
  }
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (props.disabled) return
    event.preventDefault()
    event.stopPropagation()
    trigger.current = event.currentTarget
    const rect = event.currentTarget.getBoundingClientRect()
    // The menu key reports no pointer position; open under the trigger instead.
    const keyboard = event.clientX === 0 && event.clientY === 0
    setPoint(keyboard ? { x: rect.left, y: rect.bottom } : { x: event.clientX, y: event.clientY })
    props.onOpenChange?.(true)
  }
  // A long press opens the menu on touch screens, where there is no right click.
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined>(undefined)
  const release = () => {
    if (press.current) clearTimeout(press.current.timer)
    press.current = undefined
  }
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (props.disabled || event.pointerType !== "touch") return
    release()
    const target = event.currentTarget
    const at = { x: event.clientX, y: event.clientY }
    press.current = {
      ...at,
      timer: setTimeout(() => {
        press.current = undefined
        trigger.current = target
        setPoint(at)
        props.onOpenChange?.(true)
      }, LONG_PRESS),
    }
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = press.current
    if (current && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) release()
  }
  return (
    <>
      {props.children({
        onContextMenu,
        onPointerDown,
        onPointerMove,
        onPointerUp: release,
        onPointerCancel: release,
        "aria-haspopup": "menu",
        "aria-expanded": !!point,
      })}
      {/* At the body: under a transformed ancestor (a virtual list's rows) a fixed point is placed from
          that ancestor, not the viewport, and the menu opened off screen. */}
      {point &&
        createPortal(
          <DropdownMenu open modal={false} onOpenChange={change}>
            <DropdownMenuTrigger asChild>
              <span
                aria-hidden="true"
                tabIndex={-1}
                style={{ position: "fixed", left: point.x, top: point.y, width: 0, height: 0 }}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              data-component="menu-v2-content"
              align="start"
              side="bottom"
              sideOffset={0}
              onPointerDownOutside={() => {
                // The press that dismisses the menu must not also act on what lies under it.
                const swallow = (event: Event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }
                document.addEventListener("click", swallow, { capture: true, once: true })
                setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 600)
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                if (props.onClosed?.()) return
                trigger.current?.focus()
              }}
            >
              {props.content}
            </DropdownMenuContent>
          </DropdownMenu>,
          document.body,
        )}
    </>
  )
}
