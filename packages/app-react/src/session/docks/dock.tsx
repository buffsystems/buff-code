// The frame of a request dock above the composer (#584): session-ui's DockPrompt — a header,
// the body and a tray of actions — with the data attributes the e2e specs locate.

import type { KeyboardEvent, ReactNode, Ref } from "react"
import "./docks.css"

export function DockPrompt(props: {
  kind: "question" | "permission"
  header: ReactNode
  footer: ReactNode
  children: ReactNode
  ref?: Ref<HTMLDivElement>
  onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void
}) {
  const slot = (name: string) => `${props.kind}-${name}`
  return (
    <div ref={props.ref} data-component="dock-prompt" data-kind={props.kind} className="dock-prompt" onKeyDown={props.onKeyDown}>
      <div data-slot={slot("body")} className="dock-prompt__body">
        <div data-slot={slot("header")} className="dock-prompt__header">
          {props.header}
        </div>
        <div data-slot={slot("content")} className="dock-prompt__content">
          {props.children}
        </div>
      </div>
      <div data-slot={slot("footer")} className="dock-prompt__footer">
        {props.footer}
      </div>
    </div>
  )
}
