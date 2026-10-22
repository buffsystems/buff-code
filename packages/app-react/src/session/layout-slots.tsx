// How the layout renders a slot's entries (#584): each in its own error boundary and Suspense, so
// one feature failing or loading never blanks the others; and the title until the timeline's header.

import { Component, memo, Suspense, type ReactNode } from "react"
import { useI18n } from "../i18n/provider"
import { useServerData } from "../react/core"
import { useSession } from "./context"
import type { SessionSlot } from "./slots"

/** Memoized: the frame re-renders as its regions move; the slots' contents only for their own state. */
export const SlotEntries = memo(function SlotEntries(props: { entries: SessionSlot[] }) {
  return props.entries.map((entry) => (
    <SlotBoundary key={entry.id} id={entry.id}>
      <Suspense>
        <entry.component />
      </Suspense>
    </SlotBoundary>
  ))
})

/** Until the timeline contributes its header, the session's title heads the panel. */
export function DefaultHeader(props: { placeholder?: boolean }) {
  const session = useSession()
  const title = useServerData(session.server, (state) => state.session.info[session.sessionID]?.title)
  return (
    <header data-component="session-default-header" data-session-title className="flex h-12 shrink-0 items-center px-4">
      {props.placeholder ? (
        <span className="ui-title truncate">{title ?? ""}</span>
      ) : (
        <h1 className="ui-title truncate">{title ?? ""}</h1>
      )}
    </header>
  )
}

/**
 * The title while the session screen's modules load: the same row, its title as text. The
 * screen's heading appears with the real title row, which it marks ready (renaming, its menu).
 */
export function PlaceholderHeader() {
  return <DefaultHeader placeholder />
}

/** One feature failing shows a note in its slot; the rest of the screen keeps working. */
class SlotBoundary extends Component<{ id: string; children?: ReactNode }, { error?: unknown }> {
  state: { error?: unknown } = {}
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  render() {
    if (this.state.error === undefined) return this.props.children
    return <SlotError id={this.props.id} />
  }
}

function SlotError(props: { id: string }) {
  const i18n = useI18n()
  return (
    <p data-component="session-slot-error" data-slot-id={props.id} role="alert" className="ui-note p-3">
      {i18n.t("error.page.title")}
    </p>
  )
}
