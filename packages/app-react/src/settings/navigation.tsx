// The settings frame (#584), ported from the Solid window's navigation.tsx: the side navigation —
// back, the search, the page tabs in groups — and on a narrow window a bar with back and a menu of
// the pages. Pages are tabs (role="tab") and the shown page is the one tab panel, as in the Solid
// window, so the specs and assistive tech find them by the same names.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  NavItem,
} from "@buff/ui/react"
import { ArrowLeft, ChevronDown, type LucideIcon } from "lucide-react"
import { Fragment, useId, useRef, type KeyboardEvent, type ReactNode } from "react"
import { useI18n } from "../i18n/provider"
import { useSettingsState, useSettingsSurface } from "./context"
import { SettingsSearch } from "./search"

export type SettingsNavItem = {
  value: string
  label: string
  icon: LucideIcon
  disabled?: boolean
  onPrefetch?: () => void
}

export type SettingsNavGroup = { label?: string; action?: ReactNode; items: readonly SettingsNavItem[] }

export function SettingsNavigation(props: {
  value: string
  groups: readonly SettingsNavGroup[]
  backLabel: string
  onBack: () => void
  onChange: (value: string) => void
  mobileAction?: ReactNode
  panelClassName?: string
  children?: ReactNode
}) {
  const i18n = useI18n()
  const surface = useSettingsSurface()
  const searchable = useSettingsState((state) => state.view.type === "root")
  const query = useSettingsState((state) => state.search.query)
  const selected = useSettingsState((state) => state.search.selected)
  const id = useId()
  const list = useRef<HTMLDivElement>(null)
  const items = props.groups.flatMap((group) => group.items)
  const current = items.find((item) => item.value === props.value)
  const tabID = (value: string) => `${id}-tab-${value}`
  const fromResult = !searchable && !!selected
  const backLabel = fromResult ? i18n.t("settings.backToSettings") : props.backLabel
  const back = () => {
    if (!searchable && surface.search.back()) return
    props.onBack()
  }
  const change = (value: string) => {
    surface.search.clear()
    props.onChange(value)
  }

  // Arrow keys move between the enabled pages and open them, like the Solid window's tab list.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"]
    if (!keys.includes(event.key)) return
    const enabled = items.filter((item) => !item.disabled)
    const index = enabled.findIndex((item) => item.value === props.value)
    const next =
      event.key === "Home"
        ? enabled[0]
        : event.key === "End"
          ? enabled.at(-1)
          : enabled[(index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length]
    if (!next) return
    event.preventDefault()
    change(next.value)
    list.current?.querySelector<HTMLElement>(`#${CSS.escape(tabID(next.value))}`)?.focus()
  }

  return (
    <div className="settings">
      <div className="settings-mobile-nav">
        <button type="button" className="settings-back" onClick={back}>
          <ArrowLeft aria-hidden />
          <span>{backLabel}</span>
        </button>
        <div className="settings-mobile-actions">
          {props.mobileAction}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="settings-mobile-menu-trigger" trailingIcon={ChevronDown}>
                <span>{current?.label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="settings-mobile-menu">
              <DropdownMenuRadioGroup value={props.value} onValueChange={change}>
                {props.groups.map((group, index) => (
                  <Fragment key={index}>
                    {index > 0 && <DropdownMenuSeparator />}
                    {group.items.map((item) => (
                      <DropdownMenuRadioItem
                        key={item.value}
                        value={item.value}
                        disabled={item.disabled}
                        onFocus={() => !item.disabled && item.onPrefetch?.()}
                      >
                        <item.icon aria-hidden />
                        <span className="ui-menu__text">{item.label}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </Fragment>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <aside className="settings-sidebar" data-searchable={searchable}>
        <div className="settings-nav">
          <button type="button" className="settings-back" onClick={back}>
            <ArrowLeft aria-hidden />
            <span>{backLabel}</span>
          </button>
          {searchable && <SettingsSearch />}
          {(!searchable || !query.trim()) && (
            <div
              ref={list}
              role="tablist"
              aria-orientation="vertical"
              className="settings-nav-groups"
              onKeyDown={onKeyDown}
            >
              {props.groups.map((group, index) => (
                <div key={index} className="settings-nav-group">
                  {(group.label || group.action) && (
                    <div className="settings-nav-group-header" data-component="settings-nav-group-header">
                      <span className="ui-eyebrow">{group.label}</span>
                      {group.action}
                    </div>
                  )}
                  {group.items.map((item) => (
                    <NavItem
                      key={item.value}
                      id={tabID(item.value)}
                      role="tab"
                      icon={item.icon}
                      current={item.value === props.value}
                      aria-selected={item.value === props.value}
                      aria-controls={item.value === props.value ? `${id}-panel` : undefined}
                      tabIndex={item.value === props.value ? 0 : -1}
                      disabled={item.disabled}
                      onPointerEnter={(event) => {
                        if (item.disabled || event.pointerType === "touch") return
                        item.onPrefetch?.()
                      }}
                      onFocus={() => !item.disabled && item.onPrefetch?.()}
                      onClick={() => change(item.value)}
                    >
                      {item.label}
                    </NavItem>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
      <div className="settings-content">
        <div
          key={props.value}
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={current ? tabID(current.value) : undefined}
          tabIndex={-1}
          className={["settings-panel", props.panelClassName].filter(Boolean).join(" ")}
        >
          {props.children}
        </div>
      </div>
    </div>
  )
}
