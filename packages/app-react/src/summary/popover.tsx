// «Session details» beside the session's title (#584), the Solid SummaryPopover: a button with its
// shortcut in the hint, and the summary panel under the header's end corner. While it is open the
// conversation slides aside into the spare space (motion.css reads the button's aria-expanded).

import { IconButton, Kbd, Popover, PopoverAnchor, PopoverContent, PopoverTrigger, Tooltip } from "@buff/ui/react"
import { LayoutDashboard } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { formatKeybindParts, type KeyLabel } from "../commands/keybind"
import { useCommandRegistration, useCommands } from "../commands/provider"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { SessionSummaryPanel } from "./panel"

const TOGGLE = "session.summary.toggle"

export function SummaryPopover(props: {
  server: Server
  sessionID: string
  sessionHref?: (sessionID: string) => string
  navigateToSession?: (sessionID: string) => void
  onReview?: () => void
}) {
  const i18n = useI18n()
  const commands = useCommands()
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  useCommandRegistration(`session.summary:${props.server.key}/${props.sessionID}`, () => [
    {
      id: TOGGLE,
      title: i18n.t("command.session.summary.toggle"),
      category: i18n.t("command.category.view"),
      keybind: "mod+shift+y",
      onSelect: () => setOpen((value) => !value),
    },
  ])
  useEffect(() => setOpen(false), [props.sessionID])
  // Under the header's end corner, as the Solid anchor: 12px in from its end, the button's height.
  const anchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const button = trigger.current
          const header = button?.closest("[data-session-title]")
          if (!button || !header) return button?.getBoundingClientRect() ?? new DOMRect()
          const bounds = header.getBoundingClientRect()
          const own = button.getBoundingClientRect()
          const rtl = getComputedStyle(header).direction === "rtl"
          return new DOMRect(rtl ? bounds.left + 12 : bounds.right - 12, own.top, 0, own.height)
        },
      },
    }),
    [],
  )
  const keybind = commands.keybind(TOGGLE)
  const title = i18n.t("session.summary.title")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor virtualRef={anchor} />
      <Tooltip
        side="bottom"
        open={hint && !open}
        // Radix closes a tooltip when an ancestor of its trigger scrolls. The title row sits in the
        // transcript's scroller, so the transcript settling at its end closed the hint under the
        // pointer, as Kobalte did in the Solid window (fixed there in packages/ui tooltip).
        onOpenChange={(next) => {
          if (!next && window.event?.type === "scroll" && trigger.current?.matches(":hover")) return
          setHint(next)
        }}
        content={
          <span className="flex items-center gap-2">
            {i18n.t("session.summary.tooltip")}
            {keybind && (
              <span className="flex items-center gap-0.5">
                {formatKeybindParts(keybind, (key: KeyLabel) => i18n.t(key)).map((part) => (
                  <Kbd key={part}>
                    <span data-slot="keybind-v2-label">{part}</span>
                  </Kbd>
                ))}
              </span>
            )}
          </span>
        }
      >
        <PopoverTrigger asChild>
          <IconButton
            ref={trigger}
            icon={LayoutDashboard}
            size="xs"
            data-slot="session-summary-trigger"
            data-pressed={open ? "" : undefined}
            aria-label={title}
            aria-expanded={open}
          />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={16}
        aria-label={title}
        className="session-summary-popover"
      >
        <SessionSummaryPanel
          server={props.server}
          sessionID={props.sessionID}
          shown={open}
          sessionHref={props.sessionHref}
          navigateToSession={props.navigateToSession}
          onReview={() => {
            setOpen(false)
            props.onReview?.()
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
