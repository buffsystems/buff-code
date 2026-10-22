// The side panel's tabs (#584): closable, reorderable tabs on @buff/ui's TabStrip, with the Solid
// Tabs DOM the specs locate (`tabs-trigger-wrapper` with `data-value`, a `role=tab` trigger, the
// close button beside it). The strip's close button carries the shortcut hint and the attributes
// the specs read.

import { TabStrip, TabStripTab, TabStripTrigger } from "@buff/ui/react"
import { DragDropProvider, PointerSensor } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import type { KeyboardEvent, ReactNode, Ref } from "react"
import { useI18n } from "../../i18n/provider"

const MIDDLE = 1

/** Arrow keys and Home/End move focus along the tabs, as a tablist does. */
function roving(event: KeyboardEvent<HTMLDivElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"]
  if (!keys.includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'))
  const at = tabs.indexOf(document.activeElement as HTMLElement)
  if (at === -1) return
  const rtl = getComputedStyle(event.currentTarget).direction === "rtl"
  const forward = rtl ? "ArrowLeft" : "ArrowRight"
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (at + (event.key === forward ? 1 : -1) + tabs.length) % tabs.length
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}

export function PaneTabList(props: {
  label?: string
  className?: string
  listRef?: Ref<HTMLDivElement>
  onMove?: (id: string, index: number) => void
  children?: ReactNode
}) {
  return (
    <DragDropProvider
      sensors={[
        PointerSensor.configure({
          activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
          preventActivation: (event) =>
            event.target instanceof Element && !!event.target.closest(".ui-tab-strip__close"),
        }),
      ]}
      modifiers={[RestrictToHorizontalAxis]}
      onDragEnd={(event) => {
        const source = event.operation.source
        if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
        props.onMove?.(String(source.id), source.index)
      }}
    >
      <TabStrip
        ref={props.listRef}
        label={props.label}
        data-slot="tabs-list"
        className={props.className}
        onKeyDown={roving}
      >
        {props.children}
      </TabStrip>
    </DragDropProvider>
  )
}

export type PaneTabProps = {
  value: string
  selected: boolean
  id?: string
  ariaControls?: string
  ariaLabel?: string
  onSelect: () => void
  onClose?: () => void
  onDoubleClick?: () => void
  closeHint?: ReactNode
  /** Keep the close button visible (an "Open file" tab while selected). */
  className?: string
  children?: ReactNode
}

export function PaneTab(props: PaneTabProps & { wrapperRef?: Ref<HTMLDivElement>; dragging?: boolean }) {
  const i18n = useI18n()
  return (
    <TabStripTab
      ref={props.wrapperRef}
      active={props.selected}
      dragging={props.dragging}
      data-slot="tabs-trigger-wrapper"
      data-value={props.value}
      data-selected={props.selected ? "" : undefined}
      className={props.className}
      onClose={props.onClose}
      closeLabel={i18n.t("common.closeTab")}
      closeTooltip={props.closeHint ?? i18n.t("common.closeTab")}
      closeProps={{ "data-slot": "tabs-trigger-close-button", "data-variant": "ghost-muted" }}
      onMouseDown={(event) => {
        if (event.button === MIDDLE && props.onClose) event.preventDefault()
      }}
      onAuxClick={(event) => {
        if (event.button !== MIDDLE || !props.onClose) return
        event.preventDefault()
        props.onClose()
      }}
    >
      <TabStripTrigger
        selected={props.selected}
        id={props.id}
        data-slot="tabs-trigger"
        data-value={props.value}
        data-selected={props.selected ? "" : undefined}
        aria-controls={props.ariaControls}
        aria-label={props.ariaLabel}
        dir="auto"
        onClick={props.onSelect}
        onDoubleClick={props.onDoubleClick}
      >
        {props.children}
      </TabStripTrigger>
    </TabStripTab>
  )
}

/** A tab the pointer can drag to another place in the list. */
export function SortablePaneTab(props: PaneTabProps & { index: number }) {
  const sortable = useSortable({ id: props.value, index: props.index })
  return <PaneTab {...props} wrapperRef={sortable.ref} dragging={sortable.isDragSource} />
}
