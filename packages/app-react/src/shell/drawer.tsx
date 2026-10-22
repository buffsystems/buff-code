// A bottom sheet for phones (#584): @buff/ui's Drawer with its title kept for screen readers only
// and no ×, as the Solid sheet (corvu) has neither. The specs find it by the Solid hooks: the
// backdrop, panel and handle slots, data-open while it is open and data-transitioning while it
// slides in.

import { Drawer as SheetDrawer } from "@buff/ui/react"
import { useState, type HTMLAttributes, type ReactNode } from "react"

/** Solid's data-slot hooks, as attributes the Drawer's parts take. */
const slot = (name: string, extra?: Record<string, string | undefined>): HTMLAttributes<HTMLDivElement> =>
  Object.fromEntries([["data-slot", name], ...Object.entries(extra ?? {})])

export function Drawer(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  children: ReactNode
}) {
  const [moving, setMoving] = useState({ open: false, transitioning: false })
  // Each opening slides in; the sheet is transitioning until its animation ends.
  if (moving.open !== props.open) setMoving({ open: props.open, transitioning: props.open })
  const content = slot("mobile-drawer-content", {
    "data-open": props.open ? "" : undefined,
    "data-transitioning": moving.transitioning ? "" : undefined,
  })
  return (
    <SheetDrawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.label}
      hideTitle
      hideClose
      overlayProps={slot("mobile-drawer-overlay")}
      contentProps={{
        ...content,
        onAnimationEnd: (event) => {
          if (event.target === event.currentTarget) setMoving((current) => ({ ...current, transitioning: false }))
        },
      }}
      handleProps={slot("mobile-drawer-handle")}
    >
      {props.children}
    </SheetDrawer>
  )
}
