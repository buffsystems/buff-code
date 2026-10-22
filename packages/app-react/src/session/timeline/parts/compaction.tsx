import { Button, Callout } from "@buff/ui/react"
import type { SessionMessageCompaction } from "@opencode/client/promise"
import { BuffCompaction } from "@opencode/schema/buff-compaction"
import { useState } from "react"
import { useI18n } from "../../../i18n/provider"
import { PacedMarkdown } from "../markdown/markdown"
import { BasicTool } from "./basic-tool"
import { TimelineSeparator } from "./status"

/** A compaction of the session: its start, the summary as it is written, and its outcome. */
export function CompactionMessage(props: { message: SessionMessageCompaction; error: string; onRendered?: () => void }) {
  const i18n = useI18n()
  const [summaryOpen, setSummaryOpen] = useState(false)
  const message = props.message
  const summary = message.status === "failed" ? "" : message.summary
  const error =
    message.status !== "failed" || message.error.type === "aborted" || message.error.type === "compaction.interrupted"
      ? ""
      : props.error
  const compact = new Intl.NumberFormat(i18n.intl, { notation: "compact", maximumFractionDigits: 1 })
  // Usage of the compaction request itself; the resulting context size shows on the next step.
  const usage = (() => {
    if (message.status === "running" || !message.tokens) return ""
    const input = message.tokens.input + message.tokens.cache.read + message.tokens.cache.write
    const output = message.tokens.output + message.tokens.reasoning
    if (input + output <= 0) return ""
    return i18n.t("ui.messagePart.compaction.usage", { input: compact.format(input), output: compact.format(output) })
  })()
  const outcome =
    message.status !== "failed"
      ? message.status === "completed" && message.providerContext
        ? "ui.messagePart.providerCompaction"
        : "ui.messagePart.compaction"
      : message.error.type === "aborted"
        ? "ui.messagePart.compaction.cancelled"
        : message.error.type === "compaction.interrupted"
          ? "ui.messagePart.compaction.interrupted"
          : "ui.messagePart.compaction.failed"
  const label = [i18n.t(outcome), usage].filter(Boolean).join(" · ")
  return (
    <div data-component="session-compaction-message">
      <div className="py-2">
        <TimelineSeparator label={i18n.t("ui.messagePart.compaction.started")} />
      </div>
      {summary.trim() && BuffCompaction.summaryShown(message.status, summaryOpen) && (
        <div data-component="text-part" data-timeline-part-id={message.id}>
          <div data-slot="text-part-body">
            <PacedMarkdown
              text={summary}
              cacheKey={message.id}
              streaming={message.status === "running"}
              onRendered={props.onRendered}
            />
          </div>
        </div>
      )}
      {message.status === "running" && (
        <div role="status" className="py-2">
          <BasicTool trigger={{ title: i18n.t("ui.messagePart.compaction.running") }} status="running" locked hideDetails />
        </div>
      )}
      {message.status !== "running" && (
        <div className="py-2">
          <TimelineSeparator label={label} />
        </div>
      )}
      {message.status === "completed" && summary.trim() && (
        <div className="flex justify-center">
          <Button size="sm" variant="ghost" data-action="buff-compaction-summary" onClick={() => setSummaryOpen(!summaryOpen)}>
            {i18n.buff.t(summaryOpen ? "Hide the summary for the model" : "Summary for the model")}
          </Button>
        </div>
      )}
      {error && <Callout tone="crit">{error}</Callout>}
    </div>
  )
}
