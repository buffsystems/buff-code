import { Search, X } from "lucide-react"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import type { TimelineSearch } from "./search"

/** The Find field in the session's title row, shown while a search is open. */
export function TimelineSearchBar(props: { search: TimelineSearch }) {
  const i18n = useI18n()
  const search = props.search
  const state = useStore(search.state, (value) => value)
  if (!state.visible) return null
  const placeholder = i18n.t("session.search.placeholder")
  const count = search.count()
  return (
    <div data-component="timeline-search-bar" className="timeline-search">
      <Search aria-hidden className="timeline-search__icon" />
      <input
        ref={search.setInput}
        data-slot="text-input-v2-input"
        type="search"
        className="timeline-search__input"
        value={state.value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => search.setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            return search.close()
          }
          if (event.altKey || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return
          const delta =
            event.key === "Enter" ? (event.shiftKey ? -1 : 1) : event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
          if (!delta) return
          event.preventDefault()
          search.move(delta)
        }}
      />
      {state.value && (
        <span data-slot="timeline-search-count" className="timeline-search__count">
          {count > 0 ? search.activeIndex() + 1 : 0}/{count}
        </span>
      )}
      <button
        type="button"
        className="timeline-search__close"
        aria-label={placeholder}
        onMouseDown={(event) => event.preventDefault()}
        onClick={search.close}
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}
