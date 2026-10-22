// Background work of a session (#584), the Solid session's createSessionBackground over the core
// data: the shells and subagents the model sent to the background (still running), and the
// running calls of the current turn that could be moved there. The timeline's hint, Ctrl+B, the
// session details and the composer's chip all read it.

import type { SessionMessageAssistant, ShellInfo } from "@opencode/client/promise"
import { locationKey, type DataState } from "../../core/data/state"

export type BackgroundTask = {
  id: string
  type: "shell" | "subagent"
  label: string
  agent?: string
  /** Buff (#456): when the work started, for its running time. */
  started?: number
}

export type BlockingWork = { type: "shell" | "subagent"; partID: string; id?: string; label?: string }

export type SessionBackground = { blocking: BlockingWork[]; tasks: BackgroundTask[] }

const none: SessionBackground = { blocking: [], tasks: [] }

export function sessionBackground(state: DataState, sessionID: string): SessionBackground {
  const info = state.session.info[sessionID]
  // Only a top-level session sends work to the background.
  if (!info || info.parentID) return none
  const history = backgroundHistory(state, sessionID)
  const active = Object.values(state.session.info).flatMap((child) => {
    if (child.parentID !== sessionID || state.session.active[child.id] !== "running") return []
    if (
      history.blocking.some(
        (item) => item.type === "subagent" && (item.id === child.id || (!!item.label && child.title === item.label)),
      )
    )
      return []
    return [{ id: child.id, type: "subagent" as const, label: child.title ?? child.id, started: child.time.created }]
  })
  const running = Object.values(state.location[locationKey(info.location)]?.shell ?? {}).flatMap((shell: ShellInfo) => {
    if (shell.status !== "running" || shell.metadata.sessionID !== sessionID) return []
    if (
      history.blocking.some(
        (item) => item.type === "shell" && (item.id === shell.id || (!!item.label && shell.command === item.label)),
      )
    )
      return []
    return [{ id: shell.id, type: "shell" as const, label: shell.command, started: shell.time.started }]
  })
  const tasks = [
    ...new Map<string, BackgroundTask>(
      [...history.subagents, ...active, ...history.shells, ...running].map((task) => [task.id, task]),
    ).values(),
  ]
  return { blocking: history.blocking, tasks }
}

function backgroundHistory(state: DataState, sessionID: string) {
  const completed = new Set<string>()
  const subagents: BackgroundTask[] = []
  const shells: { partID: string; task: BackgroundTask }[] = []
  const assistant = (state.session.message[sessionID] ?? []).reduce<SessionMessageAssistant | undefined>(
    (latest, message) => {
      if (message.type === "synthetic") {
        const metadata = message.metadata
        if (metadata?.source === "subagent" && typeof metadata.childID === "string") completed.add(metadata.childID)
        if (metadata?.source === "shell") {
          if (typeof metadata.shellID === "string") completed.add(metadata.shellID)
          if (typeof metadata.jobID === "string") completed.add(metadata.jobID)
        }
        return latest
      }
      if (message.type !== "assistant") return latest
      message.content.forEach((part) => {
        if (part.type !== "tool" || (part.name !== "subagent" && part.name !== "shell")) return
        if (part.state.status !== "completed" || part.state.metadata?.status !== "running") return
        const started = part.time.ran ?? part.time.created
        if (part.name === "subagent") {
          const id = part.state.metadata.sessionID
          if (typeof id !== "string") return
          const description = part.state.input.description
          const agent = part.state.input.agent
          subagents.push({
            id,
            type: "subagent",
            label: typeof description === "string" ? description : id,
            agent: typeof agent === "string" ? agent : undefined,
            started,
          })
          return
        }
        const shellID = part.state.metadata.shellID
        const command = part.state.input.command
        shells.push({
          partID: part.id,
          task: {
            id: typeof shellID === "string" ? shellID : part.id,
            type: "shell",
            label: typeof command === "string" ? command : part.id,
            started,
          },
        })
      })
      return message.time.completed === undefined ? message : latest
    },
    undefined,
  )
  return {
    // Completion notices can identify the shell or its original tool call.
    subagents: subagents.filter((task) => !completed.has(task.id)),
    shells: shells.filter((item) => !completed.has(item.partID) && !completed.has(item.task.id)).map((item) => item.task),
    blocking:
      assistant?.content.flatMap((part): BlockingWork[] => {
        if (part.type !== "tool" || part.state.status !== "running") return []
        if (part.name !== "shell" && part.name !== "subagent") return []
        const value = part.name === "shell" ? part.state.metadata.shellID : part.state.metadata.sessionID
        const label = part.name === "shell" ? part.state.input.command : part.state.input.description
        return [
          {
            type: part.name,
            partID: part.id,
            id: typeof value === "string" ? value : undefined,
            label: typeof label === "string" ? label : undefined,
          },
        ]
      }) ?? [],
  }
}

/** Equal when the same work is listed, so a streaming delta does not re-render its readers. */
export function sameBackground(previous: SessionBackground, next: SessionBackground) {
  return JSON.stringify(previous) === JSON.stringify(next)
}

/** A selector that recomputes only when the transcript, sessions, statuses or shells change. */
export function createBackgroundSelector(sessionID: string) {
  const last: { inputs?: unknown[]; value: SessionBackground } = { value: none }
  return (state: DataState) => {
    const info = state.session.info[sessionID]
    const inputs = [
      state.session.message[sessionID],
      state.session.info,
      state.session.active,
      info ? state.location[locationKey(info.location)]?.shell : undefined,
    ]
    if (last.inputs && inputs.every((input, index) => input === last.inputs![index])) return last.value
    const value = sessionBackground(state, sessionID)
    last.inputs = inputs
    if (!sameBackground(last.value, value)) last.value = value
    return last.value
  }
}
