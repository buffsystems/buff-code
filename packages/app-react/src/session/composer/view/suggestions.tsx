// The slash-command and @-mention popover above the composer (#584), ported from the Solid
// editor's ComposerEditorPopover. The editor keeps focus while it is open (a pointer press never
// takes it), except the command menu, which brings its own search field. @buff/ui's CommandList
// owns its own search field and filtering, so the inline popover — driven by the editor's keys —
// is drawn here.

import { Bot, File, Folder, Sparkles } from "lucide-react"
import type { ComposerSuggestion } from "@opencode/app/react-reuse/composer-types"
import { useEffect, useRef, type KeyboardEvent } from "react"
import { useI18n } from "../../../i18n/provider"
import { useStore } from "../../../react/use-store"
import type { ComposerController } from "../editor/controller"

export function Suggestions(props: { controller: ComposerController }) {
  const i18n = useI18n()
  const controller = props.controller
  const popover = useStore(controller.interaction, (state) => state.popover)
  const list = popover.type === "context" ? controller.lists.context : controller.lists.command
  const items = useStore(list.store, (state) => state.items)
  if (popover.type === "closed") return null
  const active = popover.activeID
  return (
    <div
      data-component="composer-suggestions"
      className="composer-suggestions"
      onMouseDown={(event) => event.preventDefault()}
    >
      {popover.type === "command-menu" && (
        <CommandSearch
          value={popover.query}
          label={i18n.t("ui.promptInput.commands")}
          onChange={controller.setQuery}
          onKeyDown={(event) => controller.onKeyDown(event.nativeEvent)}
        />
      )}
      {items.length === 0 && <div className="composer-suggestions__empty">{i18n.t("ui.promptInput.noMatchingItems")}</div>}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-suggestion-id={item.id}
          data-active={active === item.id ? "" : undefined}
          className="composer-suggestions__item"
          onPointerMove={() => controller.dispatch({ type: "popover.active", id: item.id })}
          onClick={() => controller.dispatch({ type: "popover.select", item })}
        >
          <SuggestionIcon item={item} />
          <bdi dir="auto" className="composer-suggestions__label">
            {item.label}
          </bdi>
          {item.description && <span className="composer-suggestions__description">{item.description}</span>}
          {item.keybind && item.keybind.length > 0 && (
            <span className="composer-suggestions__keybind">{item.keybind.join("+")}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function CommandSearch(props: {
  value: string
  label: string
  onChange(value: string): void
  onKeyDown(event: KeyboardEvent<HTMLInputElement>): void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div className="composer-suggestions__search">
      <input
        ref={input}
        value={props.value}
        aria-label={props.label}
        placeholder="/"
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onKeyDown={props.onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      />
    </div>
  )
}

function SuggestionIcon(props: { item: ComposerSuggestion }) {
  if (props.item.kind === "command") return null
  if (props.item.kind === "agent") return <Bot aria-hidden className="composer-suggestions__icon" />
  if (props.item.kind === "skill") return <Sparkles aria-hidden className="composer-suggestions__icon" />
  if (props.item.kind === "reference") return <Folder aria-hidden className="composer-suggestions__icon" />
  return <File aria-hidden className="composer-suggestions__icon" />
}
