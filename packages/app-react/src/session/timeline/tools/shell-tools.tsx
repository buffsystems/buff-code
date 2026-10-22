// Commands and agents (#584): the shell and execute consoles, a person's own shell command, and
// the subagent card that opens the child session.

import type { SessionMessageShell } from "@opencode/client/promise"
import { followShellOutput } from "@opencode/session-ui/shell-output"
import { Bot, ChevronRight } from "lucide-react"
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react"
import stripAnsi from "strip-ansi"
import { ProgressIndicator } from "./progress-indicator"
import { useI18n } from "../../../i18n/provider"
import { useTimeline } from "../context"
import { BasicTool, Shimmer } from "../parts/basic-tool"
import { ConsoleOutput, ShellSubmessage, ToolErrorCard } from "./common"
import { taskAgent } from "./info"
import {
  useAgents,
  useSessionDirectory,
  useSessionRunning,
  useShellOutputLoader,
  useShellRunning,
  useTaskSession,
} from "./session"
import type { ToolProps } from "./types"

function useSeen(value: boolean) {
  return useRef(value).current
}

export function ExecuteTool(props: ToolProps) {
  const i18n = useI18n()
  const pending = props.status === "streaming" || props.status === "running"
  const sawPending = useSeen(pending)
  const code = typeof props.input.code === "string" ? props.input.code : ""
  const output = stripAnsi(props.output ?? "").replace(/\r\n?/g, "\n")
  return (
    <BasicTool
      status={props.status}
      hideDetails={props.hideDetails}
      defaultOpen={props.defaultOpen}
      open={props.open}
      onOpenChange={props.onOpenChange}
      forceOpen={props.forceOpen}
      locked={props.locked}
      hasContent
      compact
      allowOpenWhilePending
      trigger={(open) => (
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <Shimmer text={i18n.t("ui.tool.execute")} active={pending} />
            </span>
            {!open && code && <ShellSubmessage text={code.split("\n", 1)[0] ?? ""} animate={sawPending} />}
          </div>
        </div>
      )}
    >
      <ConsoleOutput copy={code} variant="shell">
        <span data-slot="bash-command">{code}</span>
        {output && <span data-slot="bash-result">{output}</span>}
      </ConsoleOutput>
    </BasicTool>
  )
}

function ShellOutput(props: ToolProps & { command: string; pending: boolean }) {
  const directory = useSessionDirectory()
  const load = useShellOutputLoader()
  const [streamed, setStreamed] = useState("")
  const status = props.metadata.status
  // Direct-user terminal snapshots are authoritative; agent results can describe background shells.
  const saved = status === "exited" || status === "timeout" || status === "killed" ? props.output : undefined
  const id = typeof props.metadata.shellID === "string" ? props.metadata.shellID : undefined
  useEffect(() => {
    if (saved !== undefined || !id || !directory) return
    return followShellOutput({ id, directory, running: props.pending, load, onOutput: setStreamed })
  }, [saved !== undefined, id, directory, props.pending])
  const output = stripAnsi(saved ?? ((id && streamed) || props.output || "")).replace(/\r\n?/g, "\n")
  return (
    <ConsoleOutput copy={props.command} variant="shell">
      <span data-slot="bash-command">{props.command}</span>
      {output && <span data-slot="bash-result">{output}</span>}
    </ConsoleOutput>
  )
}

export function ShellTool(props: ToolProps) {
  const i18n = useI18n()
  const shellRunning = useShellRunning(typeof props.metadata.shellID === "string" ? props.metadata.shellID : undefined)
  const streaming = props.status === "streaming"
  const pending = streaming || props.status === "running" || shellRunning
  const sawStreaming = useSeen(streaming)
  const command =
    typeof props.input.command === "string"
      ? props.input.command
      : typeof props.metadata.command === "string"
        ? props.metadata.command
        : ""
  return (
    <BasicTool
      status={props.status}
      hideDetails={props.hideDetails}
      defaultOpen={props.defaultOpen}
      open={props.open}
      onOpenChange={props.onOpenChange}
      forceOpen={props.forceOpen}
      locked={props.locked}
      hasContent
      compact
      allowOpenWhilePending
      trigger={(open) => (
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <Shimmer text={i18n.t("ui.tool.shell")} active={pending} />
            </span>
            {!open &&
              (command ? (
                <ShellSubmessage text={command} animate={sawStreaming} />
              ) : (
                streaming && <span data-slot="basic-tool-tool-subtitle">{i18n.t("ui.tool.shell.writingCommand")}</span>
              ))}
          </div>
        </div>
      )}
    >
      <ShellOutput {...props} command={command} pending={pending} />
    </BasicTool>
  )
}

/** A command the person ran in the session ("!"), with its outcome when it failed. */
export function ShellMessage(props: {
  message: SessionMessageShell
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const i18n = useI18n()
  const message = props.message
  const error =
    message.status === "timeout"
      ? i18n.t("ui.tool.shell.timeout")
      : message.status === "killed"
        ? i18n.t("ui.tool.shell.cancelled")
        : message.status === "exited" && message.exit !== undefined && message.exit !== 0
          ? i18n.t("ui.tool.shell.exit", { code: message.exit })
          : undefined
  return (
    <div data-component="session-shell-message" data-timeline-part-id={message.id}>
      <ShellTool
        tool="shell"
        input={{ command: message.command }}
        metadata={{
          shellID: message.shellID,
          status: message.status,
          exit: message.exit,
          truncated: message.output?.truncated,
        }}
        output={message.output?.output}
        status={message.status === "running" ? "running" : "completed"}
        defaultOpen={props.defaultOpen}
        open={props.open}
        onOpenChange={props.onOpenChange}
      />
      {error && <ToolErrorCard tool="shell" error={error} subtitle={message.command} />}
    </div>
  )
}

export function SubagentTool(props: ToolProps) {
  const i18n = useI18n()
  const timeline = useTimeline()
  const agents = useAgents()
  const matched = useTaskSession(props.input)
  const metadataID = typeof props.metadata.sessionID === "string" && props.metadata.sessionID ? props.metadata.sessionID : undefined
  const childID = metadataID ?? matched
  const childRunning = useSessionRunning(childID)
  const agent = taskAgent(props.input.agent, agents)
  const background =
    props.metadata.background === true || (props.status === "completed" && props.metadata.status === "running")
  const description =
    typeof props.input.description === "string" && props.input.description ? props.input.description : childID
  const subtitle = description && background ? `${description} (background)` : description
  const running = props.status === "streaming" || props.status === "running" || childRunning
  const href = childID ? timeline.actions.sessionHref?.(childID) : undefined
  const clickable = !!(childID && (timeline.actions.navigateToSession || href))
  const open = () => {
    if (childID) timeline.actions.navigateToSession?.(childID)
  }
  const navigate = (event: MouseEvent<HTMLElement>) => {
    if (!timeline.actions.navigateToSession) return
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    event.preventDefault()
    open()
  }
  const navigateKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!clickable || href) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    open()
  }
  if (props.status === "streaming")
    return (
      <div data-component="task-tool-delegating" className="tool-task tool-task--delegating">
        <Bot aria-hidden className="tool-task__icon" />
        <Shimmer text={i18n.t("ui.tool.agent.delegating")} className="min-w-0 truncate" />
      </div>
    )
  return (
    <BasicTool
      status={props.status}
      hideDetails
      triggerHref={href}
      clickable={clickable}
      onTriggerClick={navigate}
      onTriggerKeyDown={navigateKey}
      trigger={
        <div
          data-component="task-tool-card"
          className="tool-task"
          style={{ "--task-agent-color": agent.color } as CSSProperties}
        >
          <div data-component="task-tool-surface" className="tool-task__surface">
            <div data-slot="basic-tool-tool-info-structured">
              <div data-slot="basic-tool-tool-info-main">
                {running ? (
                  <span data-component="task-tool-spinner" className="tool-task__spinner">
                    <ProgressIndicator />
                  </span>
                ) : (
                  <span data-component="task-tool-icon" className="tool-task__icon">
                    <Bot aria-hidden />
                  </span>
                )}
                <span data-component="task-tool-title" className="tool-task__title">
                  {agent.name ?? i18n.t("ui.tool.agent.default")}
                </span>
                {subtitle && <span data-slot="basic-tool-tool-subtitle">{subtitle}</span>}
              </div>
              {clickable && (
                <div data-component="task-tool-action" className="tool-task__action">
                  <ChevronRight aria-hidden />
                </div>
              )}
            </div>
          </div>
        </div>
      }
    />
  )
}
