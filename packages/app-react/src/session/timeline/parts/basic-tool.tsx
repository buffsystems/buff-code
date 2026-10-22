import { TextShimmer } from "@buff/ui/react"
import { ChevronRight } from "lucide-react"
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react"

export type TriggerTitle = {
  title: string
  subtitle?: string
  args?: string[]
  action?: ReactNode
}

export type BasicToolProps = {
  trigger: TriggerTitle | ReactNode | ((open: boolean) => ReactNode)
  children?: ReactNode
  /** Declare known content without building it to test its presence. */
  hasContent?: boolean
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  forceOpen?: boolean
  allowOpenWhilePending?: boolean
  /** Mount a default-open body a few frames late, latest tools first. */
  defer?: boolean
  locked?: boolean
  onSubtitleClick?: () => void
  onTriggerClick?: (event: MouseEvent<HTMLElement>) => void
  onTriggerKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  triggerHref?: string
  clickable?: boolean
  compact?: boolean
}

/** A text with a light sweeping across it while work goes on; the Solid window's TextShimmer contract. */
export function Shimmer(props: { text: string; active?: boolean; className?: string }) {
  const active = props.active ?? true
  return (
    <TextShimmer
      active={active}
      data-component="text-shimmer"
      data-active={active ? "true" : "false"}
      aria-label={props.text}
      className={props.className}
    >
      {props.text}
    </TextShimmer>
  )
}

const deferred: Array<{ active: boolean; run: () => void }> = []
const frame: { id?: number } = {}

// Timeline tools mount top to bottom, but the viewport starts at the latest turn: pop from the
// end so heavy default-open bodies near the bottom become interactive first.
function flushDeferred() {
  const item = deferred.pop()
  frame.id = deferred.length > 0 ? requestAnimationFrame(flushDeferred) : undefined
  if (!item) return
  if (!item.active) return flushDeferred()
  item.run()
}

function scheduleDeferred(run: () => void) {
  const item = { active: true, run }
  deferred.push(item)
  frame.id ??= requestAnimationFrame(() => {
    frame.id = requestAnimationFrame(flushDeferred)
  })
  return () => {
    item.active = false
  }
}

function isTriggerTitle(value: unknown): value is TriggerTitle {
  return typeof value === "object" && value !== null && "title" in value && typeof value.title === "string"
}

/**
 * A tool call's disclosure (#584): the Solid window's BasicTool on the design system's
 * collapsible look — a title row that opens the call's details. It keeps the Kobalte DOM
 * contract (data-component="collapsible", data-slot="collapsible-trigger|content", aria-expanded,
 * data-expanded/data-closed) the e2e specs and the virtualizer rely on.
 */
export function BasicTool(props: BasicToolProps) {
  const [local, setLocal] = useState(props.defaultOpen ?? false)
  const open = props.open ?? local
  const [ready, setReady] = useState(!props.defer && (props.defaultOpen ?? false))
  const pending = props.status === "streaming" || props.status === "running"
  const hasChildren = props.hasContent ?? !!props.children
  const content = typeof props.trigger === "function" ? props.trigger(open) : props.trigger
  const title = isTriggerTitle(content) ? content : undefined
  const first = useRef(true)

  const setOpen = (value: boolean) => {
    if (props.open === undefined) setLocal(value)
    props.onOpenChange?.(value)
  }

  useEffect(() => {
    if (props.forceOpen && !open) setOpen(true)
  })

  useEffect(() => {
    const initial = first.current
    first.current = false
    if (!props.defer) return
    if (!open) return setReady(false)
    if (ready) return
    if (initial) return scheduleDeferred(() => setReady(true))
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [open, props.defer])

  const toggle = () => {
    const value = !open
    if (pending && !props.allowOpenWhilePending) return
    if (props.locked && !value) return
    setOpen(value)
  }

  const state = open ? { "data-expanded": "" } : { "data-closed": "" }
  const arrow = hasChildren && !props.hideDetails && !props.locked && (!pending || props.allowOpenWhilePending)
  const trigger = (
    <div
      data-component="tool-trigger"
      data-clickable={props.clickable ? "true" : undefined}
      data-hide-details={props.hideDetails ? "true" : undefined}
    >
      <div data-slot="basic-tool-tool-trigger-content">
        <div data-slot="basic-tool-tool-info">
          {title ? (
            <div data-slot="basic-tool-tool-info-structured">
              <div data-slot="basic-tool-tool-info-main">
                <span data-slot="basic-tool-tool-title">
                  <Shimmer text={title.title} active={pending} />
                </span>
                {(!pending || title.subtitle || !!title.args?.length) && (
                  <>
                    {title.subtitle && (
                      <span
                        data-slot="basic-tool-tool-subtitle"
                        className={props.onSubtitleClick ? "clickable" : undefined}
                        onClick={(event) => {
                          if (!props.onSubtitleClick) return
                          event.stopPropagation()
                          props.onSubtitleClick()
                        }}
                      >
                        {title.subtitle}
                      </span>
                    )}
                    {title.args?.map((arg, index) => (
                      <span key={index} data-slot="basic-tool-tool-arg">
                        {arg}
                      </span>
                    ))}
                  </>
                )}
              </div>
              {!pending && title.action && <span data-slot="basic-tool-tool-action">{title.action}</span>}
            </div>
          ) : (
            (content as ReactNode)
          )}
        </div>
      </div>
      {arrow && (
        <div data-slot="collapsible-arrow">
          <ChevronRight aria-hidden className="ui-collapsible__chevron" />
        </div>
      )}
    </div>
  )

  const body = hasChildren && !props.hideDetails && open && (!props.defer || ready)
  return (
    <div
      data-component="collapsible"
      data-variant="normal"
      data-state={open ? "open" : "closed"}
      data-compact={props.compact ? "true" : undefined}
      className="tool-collapsible ui-collapsible"
      {...state}
    >
      {props.locked ? (
        <div data-slot="collapsible-trigger" data-locked="" data-hide-details={props.hideDetails ? "true" : undefined}>
          {trigger}
        </div>
      ) : props.triggerHref ? (
        <a
          data-slot="collapsible-trigger"
          className="ui-collapsible__trigger"
          href={props.triggerHref}
          aria-expanded={open}
          data-hide-details={props.hideDetails ? "true" : undefined}
          onClick={(event) => {
            props.onTriggerClick?.(event)
            if (event.defaultPrevented) return
          }}
          onKeyDown={props.onTriggerKeyDown}
          {...state}
        >
          {trigger}
        </a>
      ) : (
        <button
          type="button"
          data-slot="collapsible-trigger"
          className="ui-collapsible__trigger"
          aria-expanded={open}
          data-hide-details={props.hideDetails ? "true" : undefined}
          onClick={(event) => {
            props.onTriggerClick?.(event)
            if (event.defaultPrevented) return
            toggle()
          }}
          onKeyDown={props.onTriggerKeyDown}
          {...state}
        >
          {trigger}
        </button>
      )}
      {body && (
        <div data-slot="collapsible-content" className="ui-collapsible__content" {...state}>
          {props.children}
        </div>
      )}
    </div>
  )
}
