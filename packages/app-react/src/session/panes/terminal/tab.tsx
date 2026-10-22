// One terminal's tab (#584) on @buff/ui's TabStrip look: selects on mouse down, closes on its button
// or a middle click, renames in place from a double click or its context menu, and drags to reorder
// within the strip.

import { DropdownMenuItem, TabStripTab, TabStripTrigger } from "@buff/ui/react"
import { isDefaultTitle } from "@opencode/app/react-reuse/terminal-title"
import { useSortable } from "@dnd-kit/react/sortable"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useI18n } from "../../../i18n/provider"
import { ContextMenu } from "../../../shell/menu/context-menu"
import { focusTerminalById } from "./focus"
import type { LocalPTY } from "./state"
import type { WorkspaceTerminals } from "./terminals"

const MIDDLE_BUTTON = 1

export function terminalLabel(pty: LocalPTY, t: (key: "terminal.title.numbered" | "terminal.title", params?: { number: number }) => string) {
  const number = pty.titleNumber
  const numbered = Number.isFinite(number) && number > 0
  if (pty.title && !(numbered && isDefaultTitle(pty.title, number))) return pty.title
  if (numbered) return t("terminal.title.numbered", { number })
  if (pty.title) return pty.title
  return t("terminal.title")
}

export function TerminalTab(props: {
  pty: LocalPTY
  index: number
  active: boolean
  terminals: WorkspaceTerminals
  count: number
  onLastClosed: () => void
}) {
  const i18n = useI18n()
  const sortable = useSortable({ id: props.pty.id, index: props.index })
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const input = useRef<HTMLInputElement>(null)
  const blurReady = useRef(false)
  const renameAfterMenu = useRef(false)
  const id = props.pty.id

  const close = () => {
    void props.terminals.close(id)
    if (props.count === 1) props.onLastClosed()
  }

  const focus = () => {
    if (editing !== undefined) return
    props.terminals.requestFocus(id)
    props.terminals.open(id)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    focusTerminalById(id)
    const textarea = document.getElementById(`terminal-wrapper-${id}`)?.querySelector("textarea")
    if (textarea === document.activeElement) props.terminals.consumeFocus(id)
  }

  const edit = () => {
    blurReady.current = false
    setEditing(props.pty.title)
  }

  const save = () => {
    if (!blurReady.current || editing === undefined) return
    const value = editing.trim()
    if (value && value !== props.pty.title) props.terminals.update({ id, title: value })
    setEditing(undefined)
  }

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      return save()
    }
    if (event.key !== "Escape") return
    event.preventDefault()
    setEditing(undefined)
  }

  const renaming = editing !== undefined
  useEffect(() => {
    if (!renaming) return
    input.current?.focus()
    input.current?.select()
    // The blur of the double click that started editing must not save at once.
    const frame = requestAnimationFrame(() => (blurReady.current = true))
    return () => cancelAnimationFrame(frame)
  }, [renaming])

  const label = terminalLabel(props.pty, i18n.t)

  return (
    <ContextMenu
      onClosed={() => {
        if (!renameAfterMenu.current) return
        renameAfterMenu.current = false
        requestAnimationFrame(edit)
        return true
      }}
      content={
        <>
          <DropdownMenuItem onSelect={() => (renameAfterMenu.current = true)}>{i18n.t("common.rename")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={close}>{i18n.t("common.close")}</DropdownMenuItem>
        </>
      }
    >
      {(trigger) => (
        <TabStripTab
          ref={sortable.ref}
          active={props.active}
          dragging={sortable.isDragSource}
          data-slot="tabs-trigger-wrapper"
          data-value={id}
          data-selected={props.active ? "" : undefined}
          {...trigger}
          onClose={close}
          closeLabel={i18n.t("terminal.close")}
          closeProps={{ "data-slot": "tabs-trigger-close-button" }}
          onMouseDown={(event) => {
            if (event.button !== MIDDLE_BUTTON) return
            event.preventDefault()
            close()
          }}
        >
          <TabStripTrigger
            selected={props.active}
            id={`terminal-tab-${id}`}
            data-slot="tabs-trigger"
            aria-controls={`terminal-wrapper-${id}`}
            onMouseDown={(event) => {
              // Switch on mouse down to shave the press-release delay off tab switches.
              if (event.button !== 0 || renaming) return
              focus()
            }}
            onClick={(event) => {
              // Mouse navigation already happened on mouse down; detail 0 is a keyboard activation.
              if (event.detail > 0) return
              focus()
            }}
          >
            <span
              data-slot="terminal-tab-title"
              style={renaming ? { visibility: "hidden" } : undefined}
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                edit()
              }}
            >
              {label}
            </span>
          </TabStripTrigger>
          {renaming && (
            <div className="terminal-tab__rename">
              <input
                ref={input}
                type="text"
                className="terminal-tab__input"
                value={editing}
                onChange={(event) => setEditing(event.currentTarget.value)}
                onBlur={save}
                onKeyDown={keyDown}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </div>
          )}
        </TabStripTab>
      )}
    </ContextMenu>
  )
}
