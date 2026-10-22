// The desktop browser in the side panel (#584): the Solid SessionBrowserPane — back, forward,
// reload / stop and the address over a surface the native page is placed on. The native view paints
// above the DOM, so it is hidden while the panel is hidden, a dialog is open or a popover covers it.

import type { BrowserPaneCommand } from "@opencode/app/react-reuse/browser-pane"
import { IconButton, Kbd, Spinner, Tooltip } from "@buff/ui/react"
import { ChevronLeft, ChevronRight, Globe, RotateCw } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { formatKeybindParts, type KeyLabel } from "../../../commands/keybind"
import { useCommandRegistration, useCommands } from "../../../commands/provider"
import { useDialog } from "../../../dialog/dialogs"
import { useI18n } from "../../../i18n/provider"
import { usePlatform } from "../../../platform/context"
import { useStore } from "../../../react/use-store"
import type { SessionBrowser } from "./model"
import "./browser.css"

const POPOVERS = '[data-radix-popper-content-wrapper]:not(:has([role="tooltip"]))'

/** Whether a floating menu, select or popover overlaps the rectangle (tooltips excepted). */
function covered(rect: DOMRect) {
  return Array.from(document.querySelectorAll(POPOVERS)).some((element) => {
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top
  })
}

/** The page's backdrop as RGBA, resolved by the browser so any color format reaches Electron. */
function rgba(color: string) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const paint = canvas.getContext("2d", { willReadFrequently: true })
  if (!paint) return
  paint.fillStyle = color
  paint.fillRect(0, 0, 1, 1)
  const data = paint.getImageData(0, 0, 1, 1).data
  return [data[0]!, data[1]!, data[2]!, data[3]!] as const
}

export function BrowserPane(props: { browser: SessionBrowser; visible: boolean }) {
  const i18n = useI18n()
  const platform = usePlatform()
  const commands = useCommands()
  const dialog = useDialog()
  const dialogOpen = useStore(dialog.entries, (list) => list.length > 0)
  const browser = props.browser
  const tab = browser.active
  const registration = browser.registration
  const current = tab?.url === "about:blank" ? "" : (tab?.url ?? "")
  const failed = !!tab?.loadError
  const [address, setAddress] = useState("")
  const [editing, setEditing] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // A submitted navigation not reported yet keeps the empty state hidden meanwhile.
  const [navigating, setNavigating] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === "visible")
  const empty = !current && !tab?.loading && !navigating
  const surface = useRef<HTMLDivElement>(null)
  const display = useRef<HTMLDivElement>(null)
  const scheme = address.match(/^https?:\/\//i)?.[0] ?? ""
  const send = (command: BrowserPaneCommand) => browser.command(command)

  useCommandRegistration("browser.navigation", () => [
    {
      id: "browser.reload",
      title: i18n.t("command.browser.reload"),
      category: i18n.t("command.category.view"),
      keybind: "f5",
      disabled: !props.visible || !current,
      onSelect: () => tab && send({ type: "reload", tabID: tab.id } as BrowserPaneCommand),
    },
  ])

  useEffect(() => {
    if (!editing) setAddress(current)
  }, [tab?.id, current])
  // Any reported movement, a rejected or blocked request included, ends the submitted navigation.
  useEffect(() => setNavigating(false), [tab?.id, tab?.generation, tab?.loading, browser.error])
  useEffect(() => {
    if (browser.error && !editing) setAddress(current)
  }, [browser.error])

  // Measuring and placing the native view.
  const measured = useRef<string>(undefined)
  const latest = useRef({ visible: props.visible, pageVisible, empty, failed, dialogOpen, tab, registration })
  latest.current = { visible: props.visible, pageVisible, empty, failed, dialogOpen, tab, registration }
  const measure = () => {
    const element = surface.current
    const state = latest.current
    if (!element) return
    if (!state.tab) return state.registration?.setLayout()
    const rect = element.getBoundingClientRect()
    const zoom = platform.webviewZoom?.() ?? 1
    const left = Math.round(rect.left * zoom)
    const top = Math.round(rect.top * zoom)
    const right = Math.round(rect.right * zoom)
    const bottom = Math.round(rect.bottom * zoom)
    // The desktop hides blank and loading pages itself; hide here only behind the pane's own states.
    const visible =
      state.visible && state.pageVisible && !state.empty && !state.failed && !state.dialogOpen && !covered(rect)
    const color = getComputedStyle(element.closest(".ui-panel") ?? document.documentElement).backgroundColor
    const next = `${state.tab.id}:${visible}:${left}:${top}:${right}:${bottom}:${color}:${window.devicePixelRatio}`
    if (next === measured.current) return
    measured.current = next
    state.registration?.setLayout({
      tabID: state.tab.id,
      visible,
      bounds: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
      background: rgba(color),
      radius: Math.round(10 * zoom),
    })
  }
  const frames = useRef<{ id?: number; until: number }>({ until: 0 })
  const schedule = (duration = 0) => {
    frames.current.until = Math.max(frames.current.until, performance.now() + duration)
    if (frames.current.id !== undefined) return
    const tick = () => {
      frames.current.id = undefined
      measure()
      if (performance.now() < frames.current.until) frames.current.id = requestAnimationFrame(tick)
    }
    frames.current.id = requestAnimationFrame(tick)
  }

  // Leaving hides the native view of the registration that owned it, not the next session's.
  useEffect(() => () => registration?.setLayout(), [registration])

  useLayoutEffect(() => {
    measured.current = undefined
    // Native views are not clipped by a hidden panel: hide before the next frame.
    if (!props.visible || !pageVisible || dialogOpen || !tab) return void registration?.setLayout()
    schedule(300)
  }, [platform, dialogOpen, pageVisible, props.visible, tab?.id, empty, failed, registration])

  useEffect(() => {
    const element = surface.current
    if (!element) return
    // ResizeObserver runs after layout in the same frame: the native view keeps up with a pane drag.
    const resize = new ResizeObserver(() => measure())
    resize.observe(element)
    const later = () => schedule(300)
    // Floating content portals into <body>; keep measuring briefly while it settles.
    const portals = new MutationObserver(later)
    portals.observe(document.body, { childList: true })
    const appearance = new MutationObserver(later)
    appearance.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme", "class"] })
    const dark = window.matchMedia("(prefers-color-scheme: dark)")
    const visibility = () => setPageVisible(document.visibilityState === "visible")
    window.addEventListener("resize", later)
    dark.addEventListener("change", later)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      resize.disconnect()
      portals.disconnect()
      appearance.disconnect()
      window.removeEventListener("resize", later)
      dark.removeEventListener("change", later)
      document.removeEventListener("visibilitychange", visibility)
      if (frames.current.id !== undefined) cancelAnimationFrame(frames.current.id)
      frames.current.id = undefined
    }
  }, [])

  const reloadKeybind = commands.keybind("browser.reload")
  const reloadLabel = i18n.t(tab?.loading ? "prompt.action.stop" : "error.page.action.reload")
  const nav = (direction: "back" | "forward") => {
    const label = i18n.t(direction === "back" ? "common.goBack" : "common.goForward")
    return (
      <Tooltip content={label}>
        <IconButton
          icon={direction === "back" ? ChevronLeft : ChevronRight}
          size="sm"
          className="rtl:rotate-180"
          disabled={!tab?.[direction === "back" ? "canGoBack" : "canGoForward"]}
          aria-label={label}
          onClick={() => tab && send({ type: direction, tabID: tab.id } as BrowserPaneCommand)}
        />
      </Tooltip>
    )
  }

  return (
    <aside id="browser-panel" data-component="browser-pane" className="relative flex size-full min-w-0 flex-col overflow-hidden">
      <div className="panes-browser-toolbar flex h-10 shrink-0 items-center gap-1 px-3">
        {nav("back")}
        {nav("forward")}
        <Tooltip
          content={
            <span className="flex items-center gap-2">
              {reloadLabel}
              {!tab?.loading &&
                reloadKeybind &&
                formatKeybindParts(reloadKeybind, (key: KeyLabel) => i18n.t(key)).map((part) => <Kbd key={part}>{part}</Kbd>)}
            </span>
          }
        >
          {tab?.loading ? (
            <IconButton
              icon={<Spinner label={reloadLabel} />}
              size="sm"
              aria-label={reloadLabel}
              onClick={() => send({ type: "stop", tabID: tab.id } as BrowserPaneCommand)}
            />
          ) : (
            <IconButton
              icon={RotateCw}
              size="sm"
              disabled={!current}
              aria-label={reloadLabel}
              onClick={() => tab && send({ type: "reload", tabID: tab.id } as BrowserPaneCommand)}
            />
          )}
        </Tooltip>
        <form
          dir="ltr"
          className="panes-browser-address relative h-7 min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            const url = address.trim()
            if (!tab) return
            if (url || failed) {
              setSubmitted(true)
              setAddress(url)
              setNavigating(true)
              send({ type: "navigate", tabID: tab.id, url: url || "about:blank" } as BrowserPaneCommand)
            }
            event.currentTarget.querySelector("input")?.blur()
          }}
        >
          <input
            className="panes-browser-address__input h-full w-full px-2"
            spellCheck={false}
            autoComplete="off"
            value={address}
            disabled={!tab}
            placeholder={i18n.t("session.browser.address.placeholder")}
            aria-label={i18n.t("session.browser.address")}
            onFocus={(event) => {
              setEditing(true)
              event.currentTarget.select()
            }}
            onClick={(event) => event.currentTarget.select()}
            onBlur={() => {
              setEditing(false)
              if (!submitted) setAddress(current)
              setSubmitted(false)
            }}
            onChange={(event) => setAddress(event.currentTarget.value)}
            onScroll={(event) => {
              if (display.current) display.current.scrollLeft = event.currentTarget.scrollLeft
            }}
          />
          {/* The native input keeps editing and selection; this copy colours the scheme. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center px-2">
            <div ref={display} className="panes-browser-address__display w-full overflow-hidden whitespace-pre">
              <span className="panes-browser-address__scheme">{scheme}</span>
              {address.slice(scheme.length)}
            </div>
          </div>
        </form>
      </div>
      {browser.error && !failed && (
        <div role="alert" className="panes-browser-error shrink-0 px-3 py-1.5">
          {browser.error}
        </div>
      )}
      <div ref={surface} className="flex min-h-0 flex-1 items-center justify-center">
        {(empty || failed) && !browser.suspended && (
          <div dir="auto" className="flex size-full flex-col items-center justify-center gap-2 p-6 pb-[200px] text-center">
            <Globe aria-hidden className="mb-2 size-6 shrink-0" />
            <div className="ui-title">
              {i18n.t(failed ? "session.browser.failed.title" : "session.browser.empty.title")}
            </div>
            <div className="ui-note">
              {i18n.t(failed ? "session.browser.failed.description" : "session.browser.empty.description")}
            </div>
          </div>
        )}
        {browser.suspended && (
          <p role="status" className="ui-note px-6 text-center">
            {i18n.t("session.browser.suspended")}
          </p>
        )}
      </div>
    </aside>
  )
}
