// «Session details» on a phone (#584): the summary panel in @buff/ui's bottom sheet, as the Solid
// MobilePanelDrawer — closed by its ×, the backdrop, Escape, or dragging its handle down.

import { Drawer, DrawerBody } from "@buff/ui/react"
import { useRef, type HTMLAttributes, type PointerEvent } from "react"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { SessionSummaryPanel } from "./panel"

/** The Solid sheet's hooks the specs find: its backdrop, panel and handle. */
const slot = (name: string): HTMLAttributes<HTMLDivElement> => Object.fromEntries([["data-slot", name]])

/** How far down the handle is dragged before the sheet lets go: a quarter of it, at most 120px. */
export function dismissDistance(height: number) {
  return Math.min(120, height / 4)
}

export function SummaryDrawer(props: {
  server: Server
  sessionID: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onReview: () => void
  /** Where the focus goes back when the sheet closes (the menu button that opened it). */
  returnFocus?: () => HTMLElement | null | undefined
}) {
  const i18n = useI18n()
  const drag = useRef<{ id: number; start: number; sheet: HTMLElement } | undefined>(undefined)
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    current.sheet.style.transform = `translateY(${Math.max(0, event.clientY - current.start)}px)`
  }
  const release = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = undefined
    const distance = event.clientY - current.start
    current.sheet.style.transform = ""
    if (event.type === "pointerup" && distance > dismissDistance(current.sheet.offsetHeight)) props.onOpenChange(false)
  }
  return (
    <Drawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={i18n.t("session.summary.title")}
      closeLabel={i18n.t("common.close")}
      overlayProps={slot("mobile-drawer-overlay")}
      contentProps={Object.assign(slot("mobile-drawer-content"), {
        onCloseAutoFocus: (event: Event) => {
          const target = props.returnFocus?.()
          if (!target) return
          event.preventDefault()
          target.focus()
        },
      })}
      handleProps={{
        ...slot("mobile-drawer-handle"),
        className: "touch-none",
        onPointerDown: (event) => {
          const sheet = event.currentTarget.parentElement
          if (!sheet) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { id: event.pointerId, start: event.clientY, sheet }
        },
        onPointerMove: move,
        onPointerUp: release,
        onPointerCancel: release,
      }}
    >
      <DrawerBody>
        <SessionSummaryPanel
          server={props.server}
          sessionID={props.sessionID}
          shown={props.open}
          mobile
          onReview={props.onReview}
        />
      </DrawerBody>
    </Drawer>
  )
}
