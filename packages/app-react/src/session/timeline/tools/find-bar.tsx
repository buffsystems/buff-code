import { ChevronDown, ChevronUp, Search, X } from "lucide-react"
import { createPortal } from "react-dom"
import { useI18n } from "../../../i18n/provider"
import { useStore } from "../../../react/use-store"
import type { DiffFind } from "./diff-find"

/** The Find bar of a diff, fixed at the top-end of the timeline while it is open. */
export function DiffFindBar(props: { find: DiffFind }) {
  const i18n = useI18n()
  const state = useStore(props.find.state, (value) => value)
  if (!state.open) return null
  return createPortal(
    <div
      className="diff-find"
      data-component="file-search"
      style={{ top: `${state.pos.top}px`, right: `${state.pos.right}px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Search aria-hidden className="diff-find__icon" />
      <input
        ref={props.find.setInput}
        className="diff-find__input"
        placeholder={i18n.t("ui.fileSearch.placeholder")}
        aria-label={i18n.t("ui.fileSearch.placeholder")}
        value={state.query}
        onChange={(event) => props.find.setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            return props.find.close()
          }
          if (event.key !== "Enter") return
          event.preventDefault()
          props.find.next(event.shiftKey ? -1 : 1)
        }}
      />
      <span className="diff-find__count">{state.count ? `${state.index + 1}/${state.count}` : "0/0"}</span>
      <button
        type="button"
        className="diff-find__button"
        disabled={state.count === 0}
        aria-label={i18n.t("ui.fileSearch.previousMatch")}
        onClick={() => props.find.next(-1)}
      >
        <ChevronUp aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        className="diff-find__button"
        disabled={state.count === 0}
        aria-label={i18n.t("ui.fileSearch.nextMatch")}
        onClick={() => props.find.next(1)}
      >
        <ChevronDown aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        className="diff-find__button"
        aria-label={i18n.t("ui.fileSearch.close")}
        onClick={props.find.close}
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>,
    document.body,
  )
}
