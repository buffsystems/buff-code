import { Callout, Tooltip } from "@buff/ui/react"
import type { SessionStatus } from "@opencode/client/promise"
import { iconNames } from "@opencode/ui/icons/provider"
import sprite from "@opencode/ui/icons/provider-sprite.svg"
import { useEffect, useState } from "react"
import { useI18n } from "../../../i18n/provider"
import { Shimmer } from "./basic-tool"

/** A provider's mark from the shared sprite; an unknown provider gets the generic one. */
export function ProviderIcon(props: { id: string; className?: string }) {
  const id = (iconNames as readonly string[]).includes(props.id) ? props.id : "synthetic"
  return (
    <svg data-component="provider-icon" className={props.className} aria-hidden="true">
      <use href={`${sprite}#${id}`} />
    </svg>
  )
}

/** A centred label between two rules: a model switch, an interruption, a compaction. */
export function TimelineSeparator(props: { label: string; providerID?: string; variant?: string }) {
  return (
    <div className="timeline-separator">
      <span className="timeline-separator__rule" />
      <span className="timeline-separator__label">
        {props.providerID && <ProviderIcon id={props.providerID} className="timeline-separator__icon" />}
        <bdi dir="auto" className="truncate" title={props.label}>
          {props.label}
        </bdi>
        {props.variant && props.variant !== "default" && (
          <span data-slot="session-timeline-notice-variant" className="timeline-separator__variant">
            {props.variant}
          </span>
        )}
      </span>
      <span className="timeline-separator__rule" />
    </div>
  )
}

/** "Type: detail" errors show their type in bold. */
export function SessionErrorMessage(props: { message: string }) {
  const separator = props.message.indexOf(":")
  if (separator === -1) return <>{props.message}</>
  return (
    <>
      <strong>{props.message.slice(0, separator + 1)}</strong>
      {props.message.slice(separator + 1)}
    </>
  )
}

export function SessionError(props: { message: string }) {
  return (
    <div data-kind="session-error-card">
      <Callout tone="crit">
        <SessionErrorMessage message={props.message} />
      </Callout>
    </div>
  )
}

/** A failed step waiting for its next attempt, counting down to it. */
export function SessionRetry(props: { status: SessionStatus; show?: boolean }) {
  const i18n = useI18n()
  const retry = props.status.type === "retry" ? props.status : undefined
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!retry) return
    const update = () => setSeconds(Math.round((retry.next - Date.now()) / 1000))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [retry?.next])
  if (!retry || props.show === false) return null
  const message =
    retry.message.includes("exceeded your current quota") && retry.message.includes("gemini")
      ? i18n.t("ui.sessionTurn.retry.geminiHot")
      : retry.message.length > 80
        ? retry.message.slice(0, 80) + "…"
        : retry.message
  const count = Math.max(0, seconds)
  const line = [i18n.t("ui.sessionTurn.retry.retrying"), count > 0 ? i18n.t("ui.sessionTurn.retry.inSeconds", { seconds: count }) : ""]
    .filter(Boolean)
    .join(" ")
  const info = line
    ? i18n.t("ui.sessionTurn.retry.attemptRetrying", { line, attempt: retry.attempt })
    : i18n.t("ui.sessionTurn.retry.attemptLabel", { attempt: retry.attempt })
  return (
    <div data-slot="session-turn-retry" data-kind="session-retry-card" className="w-full min-w-0">
      <Callout tone="crit">
        <Tooltip content={retry.message}>
          <div data-slot="session-turn-retry-message" className="truncate">
            <SessionErrorMessage message={message} />
          </div>
        </Tooltip>
        <div data-slot="session-turn-retry-info">
          <Shimmer text={info} />
        </div>
      </Callout>
    </div>
  )
}
