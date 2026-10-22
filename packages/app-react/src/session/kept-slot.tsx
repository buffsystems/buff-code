// A slot kept mounted while the layout around it changes (#584): the Solid session screen keeps
// its timeline in place when the window crosses the phone breakpoint, where this window swaps the
// desktop frame for the phone one. The slot renders once, into an element of its own, and each
// frame's <KeptSlotPlace> attaches that element where the slot goes. It renders while a place is
// mounted, so a phone view that shows another tab still drops it, as before.

import { createContext, use, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

const KeptSlotContext = createContext<((parent: HTMLElement) => () => void) | undefined>(undefined)

export function KeptSlot(props: { slot: ReactNode; children: ReactNode }) {
  const [host] = useState(() => {
    const element = document.createElement("div")
    element.style.display = "contents"
    return element
  })
  const [places, setPlaces] = useState(0)
  const [place] = useState(() => (parent: HTMLElement) => {
    parent.append(host)
    setPlaces((count) => count + 1)
    return () => {
      if (host.parentNode === parent) host.remove()
      setPlaces((count) => count - 1)
    }
  })
  return (
    <KeptSlotContext value={place}>
      {places > 0 && createPortal(props.slot, host)}
      {props.children}
    </KeptSlotContext>
  )
}

/** Where the kept slot shows in this frame. */
export function KeptSlotPlace() {
  const place = use(KeptSlotContext)
  const parent = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => place?.(parent.current!), [place])
  return <div ref={parent} className="contents" />
}
