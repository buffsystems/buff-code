// The settings search (#584), ported from the Solid window's search.tsx: one field in the side
// navigation finds pages, settings, servers and projects (the index and the ranking are the Solid
// window's own modules); the results are a listbox driven from the field, and opening a result
// shows its page with the control highlighted.

import { Input, IconButton } from "@buff/ui/react"
import { settingsSearchIndex } from "./search-index"
import { rankSettings, type SettingsSearchResult } from "./search-results"
import { CircleX, Search } from "lucide-react"
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useCommandRegistration } from "../commands/provider"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { useMobile } from "../shell/media"
import { ProjectAvatar } from "../shell/project-avatar"
import { useSettingsState, useSettingsSurface } from "./context"
import { pageIcons } from "./icons"
import { ScrollThumb } from "../react/scroll-thumb"
import { useSettingsServers, useSettingsServerSnapshots } from "./use-inventory"

type Category =
  | "settings.search.group.pages"
  | "settings.search.group.settings"
  | "settings.search.group.projects"
  | "settings.search.group.servers"

const category = (item: SettingsSearchResult): Category =>
  item.topLevel
    ? "settings.search.group.pages"
    : !item.entity
      ? "settings.search.group.settings"
      : item.project
        ? "settings.search.group.projects"
        : "settings.search.group.servers"

export function SettingsSearch() {
  const i18n = useI18n()
  const platform = usePlatform()
  const mobile = useMobile()
  const surface = useSettingsSurface()
  const search = useSettingsState((state) => state.search)
  const view = useSettingsState((state) => state.view)
  const servers = useSettingsServers()
  const snapshots = useSettingsServerSnapshots(servers)
  const listID = `settings-results-${useId().replaceAll(":", "")}`
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [overflow, setOverflow] = useState({ start: false, end: false })

  const updateOverflow = () => {
    const field = input.current
    if (!field) return
    const offset = Math.abs(field.scrollLeft)
    const next = { start: offset > 1, end: field.scrollWidth - field.clientWidth - offset > 1 }
    setOverflow((current) => (current.start === next.start && current.end === next.end ? current : next))
  }
  useLayoutEffect(updateOverflow, [search.query])
  useEffect(() => {
    const field = input.current
    const screen = root.current?.closest<HTMLElement>(".settings-screen")
    if (!field || !screen) return
    const observer = new ResizeObserver(() => {
      updateOverflow()
      setNarrow(screen.clientWidth < 800)
    })
    observer.observe(field)
    observer.observe(screen)
    setNarrow(screen.clientWidth < 800)
    return () => observer.disconnect()
  }, [])

  useCommandRegistration("settings.search", () => [
    {
      id: "settings.search.focus",
      title: i18n.t("settings.search.placeholder"),
      keybind: "mod+f",
      hidden: true,
      onSelect: () => {
        input.current?.focus({ preventScroll: true })
        input.current?.select()
      },
    },
  ])

  const catalog = useMemo(
    () =>
      settingsSearchIndex({
        servers: snapshots,
        desktop: platform.platform === "desktop",
        browser: false,
        dev: import.meta.env.VITE_OPENCODE_CHANNEL !== "prod",
        mobile,
        translate: i18n.t,
      }),
    [snapshots, platform.platform, mobile, i18n],
  )
  const origin = search.origin ?? view
  const matches = useMemo(() => rankSettings(search.query, catalog, origin), [search.query, catalog, origin])
  const shown = useMemo(() => {
    const groups = new Map<Category, SettingsSearchResult[]>()
    matches.slice(0, 60).forEach((item) => groups.set(category(item), [...(groups.get(category(item)) ?? []), item]))
    return [...groups.values()].flat()
  }, [matches])
  const iconGroups = new Set(shown.filter((item) => item.topLevel || item.projectInfo).map(category))
  const expanded = !!search.query.trim() && (!narrow || search.expanded)
  const highlighted = shown.find((item) => item.id === search.highlighted) ?? shown[0]
  const optionID = (id: string) => `${listID}-${encodeURIComponent(id).replaceAll("%", "_")}`
  const group = (item: SettingsSearchResult) => {
    if (item.entity && !item.project) return ""
    if (!item.server || servers.length > 1) return item.owner
    return item.projectName ?? ""
  }

  // A new query starts at the top; coming back to the same query keeps where the list was, once
  // the rows it was scrolled over are there again.
  const pending = useRef<number | undefined>(search.scrollTop || undefined)
  const firstQuery = useRef(search.query)
  useLayoutEffect(() => {
    const list = results.current
    if (search.query !== firstQuery.current) {
      firstQuery.current = search.query
      pending.current = undefined
      if (list) list.scrollTop = 0
      return
    }
    const target = pending.current
    if (!list || target === undefined || list.scrollHeight - list.clientHeight < target) return
    list.scrollTop = target
    pending.current = undefined
  }, [search.query, shown])

  const select = (item: SettingsSearchResult) => {
    surface.search.open(item.view, item.id)
    if (!narrow || item.view.type !== "root") return
    input.current?.blur()
    root.current?.closest<HTMLElement>(".settings-screen")?.focus({ preventScroll: true })
  }
  const clear = () => {
    surface.search.clear()
    input.current?.focus()
  }

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey) return
    if (event.metaKey || event.shiftKey) return
    const fromInput = event.target === input.current
    const fromResult = event.target instanceof Element && !!event.target.closest(".settings-search-result")
    if (!fromInput && !fromResult) return
    if (event.key === "Escape" && search.query) {
      event.preventDefault()
      event.stopPropagation()
      clear()
      return
    }
    if (event.key === "Enter" && expanded && highlighted) {
      event.preventDefault()
      event.stopPropagation()
      select(highlighted)
      return
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    if ((event.key === "Home" || event.key === "End") && fromInput) return
    event.preventDefault()
    event.stopPropagation()
    surface.search.expand()
    const index = shown.findIndex((item) => item.id === highlighted?.id)
    const next =
      shown[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? shown.length - 1
            : Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
      ]
    if (!next) return
    surface.search.highlight(next.id)
    const row = results.current?.querySelector<HTMLElement>(`#${CSS.escape(optionID(next.id))}`)
    if (!fromInput) row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }

  return (
    <div
      ref={root}
      className="settings-search"
      data-expanded={search.expanded}
      data-empty={!search.query.trim()}
      onKeyDownCapture={onKeyDownCapture}
    >
      <div className="settings-search-field">
        <Input
          ref={input}
          type="search"
          role="combobox"
          leadingIcon={Search}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-activedescendant={expanded && highlighted ? optionID(highlighted.id) : undefined}
          aria-controls={search.query.trim() ? listID : undefined}
          aria-label={i18n.t("settings.search.placeholder")}
          placeholder={i18n.t("settings.search.placeholder")}
          value={search.query}
          data-overflow-start={overflow.start}
          data-overflow-end={overflow.end}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => surface.search.expand()}
          onScroll={updateOverflow}
          onChange={(event) => surface.search.input(event.currentTarget.value)}
        />
        {search.query && (
          <IconButton
            icon={CircleX}
            size="xs"
            className="settings-search-clear"
            aria-label={i18n.t("common.clear")}
            onClick={clear}
          />
        )}
      </div>
      {search.query.trim() && (
        <div className="settings-search-matches">
          <div
            className="settings-search-scroll"
            data-empty={!shown.length}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          >
            <div
              ref={results}
              className="scroll-view__viewport settings-search-results"
              onScroll={(event) => surface.search.scroll(event.currentTarget.scrollTop)}
            >
              <div id={listID} role="listbox" aria-label={i18n.t("settings.search.results")}>
                {shown.map((item, index) => {
                  const previous = shown[index - 1]
                  const newCategory = !previous || category(previous) !== category(item)
                  const label = group(item)
                  return (
                    <Fragment key={item.id}>
                      {newCategory && (
                        <div className="settings-search-category" role="presentation">
                          {i18n.t(category(item))}
                        </div>
                      )}
                      {label && (newCategory || (previous && group(previous) !== label)) && (
                        <div className="settings-search-group" role="presentation">
                          <bdi dir="auto">{label}</bdi>
                        </div>
                      )}
                      <SearchResult
                        item={item}
                        id={optionID(item.id)}
                        highlighted={highlighted?.id === item.id}
                        current={search.selected === item.id}
                        icons={iconGroups.has(category(item))}
                        onFocus={() => surface.search.highlight(item.id)}
                        onSelect={(element) => {
                          if (item.view.type === "root" && !narrow) element.focus({ preventScroll: true })
                          select(item)
                        }}
                      />
                    </Fragment>
                  )
                })}
              </div>
            </div>
            <ScrollThumb viewport={results} hovered={hovered} />
          </div>
          {!matches.length && <SearchEmpty query={search.query} />}
          {matches.length > shown.length && <p className="settings-search-note">{i18n.t("settings.search.refine")}</p>}
        </div>
      )}
    </div>
  )
}

function SearchResult(props: {
  item: SettingsSearchResult
  id: string
  highlighted: boolean
  current: boolean
  icons: boolean
  onFocus: () => void
  onSelect: (element: HTMLButtonElement) => void
}) {
  const i18n = useI18n()
  const item = props.item
  const Icon = item.topLevel && item.view.type === "root" ? pageIcons[item.view.tab] : undefined
  const label =
    item.page === item.title && !item.owner
      ? item.title
      : i18n.t(
          item.page === item.title
            ? "settings.search.page"
            : item.owner
              ? "settings.search.result"
              : "settings.search.result.unscoped",
          { title: item.title, scope: item.owner, page: item.page },
        )
  return (
    <button
      id={props.id}
      type="button"
      role="option"
      aria-selected={props.highlighted}
      aria-label={label}
      aria-current={props.current ? "location" : undefined}
      className="settings-search-result"
      data-icons={props.icons}
      data-setting-target={item.view.target}
      data-result-id={item.id}
      data-highlighted={props.highlighted}
      title={[item.owner, item.page].filter(Boolean).join(" › ")}
      tabIndex={props.highlighted ? 0 : -1}
      onFocus={props.onFocus}
      onClick={(event) => props.onSelect(event.currentTarget)}
    >
      <span className="settings-search-label">
        {item.projectInfo ? <ProjectAvatar name={item.title} /> : Icon ? <Icon aria-hidden /> : <span aria-hidden />}
        <bdi dir="auto" className="settings-search-title">
          {item.title}
        </bdi>
      </span>
      {item.page !== item.title && !(item.entity && item.project) && (
        <span className="settings-search-detail">{item.page}</span>
      )}
    </button>
  )
}

// «No results for "…"»: the quoted query is cut to the room left, keeping the closing quote.
function SearchEmpty(props: { query: string }) {
  const i18n = useI18n()
  const container = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLSpanElement>(null)
  const [query, setQuery] = useState(props.query)
  const quoted = (value: string) => i18n.t("settings.search.empty.query", { query: value })
  const [before, after] = i18n.t("settings.search.empty", { query: "\u0000" }).split("\u0000")

  useLayoutEffect(() => {
    const box = container.current
    const probe = measure.current
    if (!box || !probe) return
    const update = () => {
      const style = getComputedStyle(box)
      probe.textContent = `${before ?? ""}${after ?? ""}`
      const room =
        box.clientWidth -
        parseFloat(style.paddingInlineStart) -
        parseFloat(style.paddingInlineEnd) -
        probe.getBoundingClientRect().width
      const fits = (value: string) => {
        probe.textContent = quoted(value)
        return probe.getBoundingClientRect().width <= room
      }
      if (fits(props.query)) return setQuery(props.query)
      const characters = Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(props.query),
        (part) => part.segment,
      )
      const bounds = { start: 0, end: characters.length }
      while (bounds.start < bounds.end) {
        const middle = Math.ceil((bounds.start + bounds.end) / 2)
        if (fits(`${characters.slice(0, middle).join("").trimEnd()}…`)) {
          bounds.start = middle
          continue
        }
        bounds.end = middle - 1
      }
      setQuery(`${characters.slice(0, bounds.start).join("").trimEnd()}…`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(box)
    observer.observe(probe)
    return () => observer.disconnect()
  }, [props.query, i18n])

  return (
    <>
      <div
        ref={container}
        className="settings-search-empty"
        role="status"
        aria-label={i18n.t("settings.search.empty", { query: quoted(props.query) })}
      >
        {before}
        <span className="settings-search-empty-quoted">
          <bdi dir="auto">{quoted(query)}</bdi>
        </span>
        {after}
      </div>
      <span className="settings-search-empty-measure" aria-hidden>
        <span ref={measure} dir="auto" />
      </span>
    </>
  )
}
