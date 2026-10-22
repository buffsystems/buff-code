// The composer toolbar's controls (#584), ported from the Solid editor (editor.tsx): the add menu,
// a select for the agent or variant, the send/stop button and the "Steer / Queue" hint.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Tooltip,
  cx,
} from "@buff/ui/react"
import { ArrowUp, ChevronDown, CornerDownLeft, Plus, Square } from "lucide-react"
import type { ReactNode } from "react"
import { useI18n } from "../../../i18n/provider"

export type SelectOption = { id: string; label: string }

function Hint(props: { title: string; keys?: string[] }) {
  return (
    <span className="inline-flex items-center gap-2">
      {props.title}
      {props.keys && props.keys.length > 0 && <Kbd>{props.keys.join(" ")}</Kbd>}
    </span>
  )
}

export function AddMenu(props: {
  disabled?: boolean
  keys: string[]
  attachShortcut: string
  onAttach(): void
  onCommands(): void
  onContext(): void
  onShell(): void
}) {
  const i18n = useI18n()
  const title = i18n.t("ui.promptInput.add")
  const item = (label: string, shortcut: string, onSelect: () => void) => (
    <DropdownMenuItem onSelect={onSelect} shortcut={shortcut}>
      {label}
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu modal={false}>
      <Tooltip content={<Hint title={title} keys={props.keys} />}>
        <DropdownMenuTrigger asChild>
          <IconButton
            data-action="composer-attach"
            type="button"
            icon={Plus}
            size="sm"
            disabled={props.disabled}
            aria-label={title}
          />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" sideOffset={6} style={{ minWidth: 180 }}>
        {item(i18n.t("ui.promptInput.attachments"), props.attachShortcut, props.onAttach)}
        <DropdownMenuSeparator />
        {item(i18n.t("ui.promptInput.commands"), "/", props.onCommands)}
        {item(i18n.t("ui.promptInput.context"), "@", props.onContext)}
        {item(i18n.t("ui.promptInput.shell"), "!", props.onShell)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A compact select in the toolbar: the agent or the model variant. */
export function SelectControl(props: {
  title: string
  keys?: string[]
  options: SelectOption[]
  current: string
  className?: string
  icon?: ReactNode
  onSelect(id: string): void
}) {
  const label = props.options.find((option) => option.id === props.current)?.label ?? props.current
  return (
    <DropdownMenu modal={false}>
      <Tooltip content={<Hint title={props.title} keys={props.keys} />}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className={cx("composer__select", props.className)} aria-label={props.title}>
            {props.icon}
            <span className="composer__select-label">{label}</span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" sideOffset={6}>
        <DropdownMenuRadioGroup value={props.current} onValueChange={props.onSelect}>
          {props.options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className="capitalize">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SubmitButton(props: {
  mode: "normal" | "shell"
  stopping: boolean
  disabled: boolean
  onSubmit(): void
  onStop(): void
}) {
  const i18n = useI18n()
  const label = props.stopping ? i18n.t("ui.promptInput.stop") : i18n.t("ui.promptInput.send")
  const icon = props.stopping ? Square : props.mode === "shell" ? CornerDownLeft : ArrowUp
  const button = (
    <IconButton
      data-action="composer-submit"
      type="button"
      variant="primary"
      size="xs"
      icon={icon}
      className="composer__submit"
      disabled={!props.stopping && props.disabled}
      tabIndex={props.mode === "normal" ? undefined : -1}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (props.stopping) return props.onStop()
        props.onSubmit()
      }}
    />
  )
  if (!props.stopping && props.disabled) return button
  return <Tooltip content={label}>{button}</Tooltip>
}

/** "Steer ⌘⏎" / "Queue ⌘⏎": sends with the delivery opposite to plain Enter's. */
export function AlternateDelivery(props: { delivery: "steer" | "queue"; keys: string[]; onSubmit(): void }) {
  const i18n = useI18n()
  const button = (
    <Button
      data-action="composer-alternate-delivery"
      type="button"
      variant="ghost"
      size="sm"
      className="composer__hint"
      onClick={props.onSubmit}
    >
      {props.delivery === "steer" ? i18n.t("ui.promptInput.steer") : i18n.t("ui.promptInput.queue")}
      <span className="hidden sm:block">
        <Kbd>{props.keys.join(" ")}</Kbd>
      </span>
    </Button>
  )
  if (props.delivery !== "steer") return button
  return <Tooltip content={i18n.t("ui.promptInput.steerHint")}>{button}</Tooltip>
}

export function ExitShell(props: { keys: string[]; onExit(): void }) {
  const i18n = useI18n()
  return (
    <Button data-action="composer-exit-shell" type="button" variant="ghost" size="sm" className="composer__hint" onClick={props.onExit}>
      {i18n.t("ui.promptInput.exitShell")}
      <span className="hidden sm:block">
        <Kbd>{props.keys.join(" ")}</Kbd>
      </span>
    </Button>
  )
}
