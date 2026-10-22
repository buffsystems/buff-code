// The pullout above the composer listing prompts queued behind the running turn (#584), ported
// from the Solid queue panel: edit a row in the composer, steer it into the turn, remove it, drag
// it to another place. It slides under the composer card so both read as one surface.

import { Button, IconButton, Tooltip, cx } from "@buff/ui/react"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { AutoScroller, Feedback, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@dnd-kit/helpers"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { SortableKeyboardPlugin } from "@dnd-kit/dom/sortable"
import { ArrowUp, GripVertical, X } from "lucide-react"
import { useMemo, useRef } from "react"
import { useI18n } from "../../../i18n/provider"
import { useServerData } from "../../../react/core"
import { useStore } from "../../../react/use-store"
import { useSession } from "../../context"
import { queuedPromptRows, queuedPrompts, type SessionQueue } from "./queue"
import "./queue.css"

type Row = ReturnType<typeof queuedPromptRows>[number]

export function QueuePanel(props: { queue: SessionQueue }) {
  const i18n = useI18n()
  const { server, sessionID } = useSession()
  const pending = useServerData(server, (state) => state.session.pending[sessionID])
  const replacement = useStore(props.queue.state, (state) => (state.replacement?.delivery === "queue" ? state.replacement : undefined))
  const editing = useStore(props.queue.state, (state) => state.editing?.id)
  const busy = useStore(props.queue.state, (state) => state.busy)
  const working = useServerData(server, (state) => state.session.active[sessionID] === "running")
  const rows = useMemo(() => queuedPromptRows(queuedPrompts(pending), replacement), [pending, replacement])
  const list = useRef<HTMLDivElement>(null)
  if (rows.length === 0) return null
  return (
    <div
      data-component="session-queue-panel"
      className={cx("session-queue", rows.length > 4 ? "session-queue--scroll" : undefined)}
    >
      {rows.length > 3 && <div className="session-queue__count">{i18n.plural("session.queue.count", rows.length)}</div>}
      <DragDropProvider
        sensors={(defaults) => [
          ...defaults.filter((sensor) => sensor !== PointerSensor),
          PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })] }),
        ]}
        modifiers={[RestrictToVerticalAxis, RestrictToElement.configure({ element: () => list.current })]}
        plugins={(defaults) => [
          ...defaults.filter((plugin) => plugin !== AutoScroller && plugin !== Feedback),
          AutoScroller.configure({ acceleration: 8, threshold: { x: 0, y: 0.05 } }),
          Feedback.configure({ dropAnimation: null }),
        ]}
        onDragEnd={(event) => {
          // Rows keep their place while dragged: React owns their order, which changes once the
          // server holds the new one. The drop target names where the row goes.
          const { source, target } = event.operation
          if (event.canceled || !isSortable(source) || !isSortable(target)) return
          if (source.initialIndex === target.index) return
          void props.queue.reorder(arrayMove(rows.map((row) => row.id), source.initialIndex, target.index))
        }}
      >
        <div ref={list} className="session-queue__list">
          {rows.map((row, index) => (
            <QueueRow
              key={row.id}
              row={row}
              index={index}
              queue={props.queue}
              editing={editing === row.id}
              busy={busy}
              working={working}
            />
          ))}
        </div>
      </DragDropProvider>
    </div>
  )
}

function QueueRow(props: { row: Row; index: number; queue: SessionQueue; editing: boolean; busy: boolean; working: boolean }) {
  const i18n = useI18n()
  const sortable = useSortable({
    id: props.row.id,
    index: props.index,
    disabled: props.busy,
    plugins: [SortableKeyboardPlugin],
  })
  // While the turn is stopped the queue stays parked: the first row shows its actions and reads Send.
  const active = !props.working && props.index === 0
  const attachments = props.row.attachments ? i18n.plural("session.queue.attachments", props.row.attachments) : ""
  const steer = (
    <Button
      data-action="session-queue-steer"
      type="button"
      size="sm"
      variant="ghost"
      leadingIcon={ArrowUp}
      disabled={props.busy}
      onClick={() => void props.queue.steer(props.row.id)}
    >
      {props.working ? i18n.t("session.queue.steer") : i18n.t("session.queue.send")}
    </Button>
  )
  return (
    <div
      ref={sortable.ref}
      data-component="session-queue-row"
      className={cx(
        "session-queue__row",
        props.editing && "session-queue__row--editing",
        sortable.isDragSource && "session-queue__row--dragging",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button ref={sortable.handleRef} type="button" className="session-queue__handle" aria-label={i18n.t("session.queue.reorder")}>
          <GripVertical aria-hidden />
        </button>
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            data-action="session-queue-edit"
            dir="auto"
            disabled={props.busy}
            className="session-queue__text"
            onClick={() => props.queue.edit(props.row.id)}
          >
            {props.row.text || attachments}
          </button>
          {props.row.attachments > 0 && props.row.text && <span className="session-queue__meta">{attachments}</span>}
        </div>
      </div>
      <div
        data-slot="session-queue-actions"
        className={cx("session-queue__actions", !active && !props.editing && "session-queue__actions--hover", props.busy && "pointer-events-none")}
      >
        {!props.editing && (props.working ? <Tooltip content={i18n.t("session.queue.steerTooltip")}>{steer}</Tooltip> : steer)}
        <Tooltip content={i18n.t("session.queue.remove")}>
          <IconButton
            data-action="session-queue-remove"
            type="button"
            size="xs"
            icon={X}
            disabled={props.busy}
            aria-label={i18n.t("session.queue.remove")}
            onClick={() => void props.queue.remove(props.row.id)}
          />
        </Tooltip>
      </div>
    </div>
  )
}
