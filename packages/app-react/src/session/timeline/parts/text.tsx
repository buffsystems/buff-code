import { IconButton, Tooltip } from "@buff/ui/react"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
} from "@opencode/client/promise"
import { reasoningHeading } from "@opencode/session-ui/timeline/projection"
import { Check, Copy, RotateCcw, type LucideIcon } from "lucide-react"
import { useEffect, useState, type MouseEvent } from "react"
import { useI18n } from "../../../i18n/provider"
import { PacedMarkdown } from "../markdown/markdown"
import { BasicTool, Shimmer } from "./basic-tool"

/** Copy through a hidden textarea first: it works without the clipboard permission. */
export async function writeClipboard(text: string) {
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  if (copied) return true
  if (!navigator.clipboard?.writeText) return false
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  )
}

const icons: Record<"check" | "copy" | "reset", LucideIcon> = { check: Check, copy: Copy, reset: RotateCcw }

export function MessageActionButton(props: {
  icon: "check" | "copy" | "reset"
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip content={props.label}>
      <IconButton
        icon={icons[props.icon]}
        size="xs"
        aria-label={props.label}
        disabled={props.disabled}
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
        onClick={(event: MouseEvent) => {
          event.stopPropagation()
          props.onClick()
        }}
      />
    </Tooltip>
  )
}

/** A two-second "copied" state after a copy. */
export function useCopied() {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return [copied, () => setCopied(true)] as const
}

export function useDuration() {
  const i18n = useI18n()
  return (ms: number) => {
    const total = Math.round(ms / 1000)
    const format = new Intl.NumberFormat(i18n.intl)
    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: format.format(total) })
    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: format.format(Math.floor(total / 60)),
      seconds: format.format(total % 60),
    })
  }
}

/** An answer's text part, with the turn's copy action and meta under its last answer. */
export function AssistantText(props: {
  id: string
  text: string
  message: SessionMessageAssistant
  modelName: string
  showCopy: boolean
  turnDurationMs?: number | null
  onRendered?: () => void
}) {
  const i18n = useI18n()
  const duration = useDuration()
  const [copied, markCopied] = useCopied()
  if (!props.text) return null
  const type = props.message.error?.type.toLowerCase()
  const interrupted = !!type && (type.includes("abort") || type.includes("interrupt"))
  const completed = props.message.time.completed
  const ms =
    props.turnDurationMs === null
      ? -1
      : typeof props.turnDurationMs === "number"
        ? props.turnDurationMs
        : typeof completed === "number"
          ? completed - props.message.time.created
          : -1
  const agent = props.message.agent
  const meta = [
    agent ? agent[0]?.toUpperCase() + agent.slice(1) : "",
    props.modelName,
    ms >= 0 ? duration(ms) : "",
    interrupted ? i18n.t("ui.message.interrupted") : "",
  ]
    .filter(Boolean)
    .join(" · ")
  const label = copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")
  return (
    <div data-component="text-part" data-timeline-part-id={props.id}>
      <div data-slot="text-part-body">
        <PacedMarkdown
          text={props.text}
          cacheKey={props.id}
          streaming={typeof completed !== "number"}
          onRendered={props.onRendered}
        />
      </div>
      {props.showCopy && (
        <div data-slot="text-part-copy-wrapper" data-interrupted={interrupted ? "" : undefined} className="timeline-meta">
          <MessageActionButton
            icon={copied ? "check" : "copy"}
            label={label}
            onClick={() => void writeClipboard(props.text).then((done) => done && markCopied())}
          />
          {meta && (
            <span data-slot="text-part-meta" className="timeline-meta__text">
              {meta}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** A thought: "Thinking…" with its heading while it streams, its duration once done. */
export function AssistantReasoning(props: {
  id: string
  content: SessionMessageAssistantReasoning
  streaming: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onContentRendered?: () => void
}) {
  const i18n = useI18n()
  const duration = useDuration()
  const [local, setLocal] = useState<boolean | undefined>(undefined)
  const open = props.open ?? local ?? props.defaultOpen ?? false
  const heading = props.streaming ? reasoningHeading(props.content.text) : ""
  const time = props.content.time
  const spent =
    time?.completed === undefined ? undefined : duration(Math.max(0, time.completed - time.created))
  return (
    <div data-component="reasoning-part" data-timeline-part-id={props.id}>
      <BasicTool
        status={props.streaming ? "running" : "completed"}
        compact
        hasContent
        allowOpenWhilePending
        hideDetails={!props.content.text.trim()}
        open={open}
        onOpenChange={(value) => {
          setLocal(value)
          props.onOpenChange?.(value)
          props.onContentRendered?.()
        }}
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <Shimmer
                  text={i18n.t(props.streaming ? "ui.sessionTurn.status.thinking" : "ui.message.thought")}
                  active={props.streaming}
                />
              </span>
              {props.streaming && !open && heading && <span data-slot="basic-tool-tool-subtitle">{heading}</span>}
              {!props.streaming && spent && <span data-slot="basic-tool-tool-subtitle">{spent}</span>}
            </div>
          </div>
        }
      >
        <PacedMarkdown
          text={props.content.text}
          cacheKey={props.id}
          streaming={props.streaming}
          onRendered={props.onContentRendered}
        />
      </BasicTool>
    </div>
  )
}
