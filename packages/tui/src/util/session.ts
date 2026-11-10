import type { ModelInfo, SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { BuffContextWindow } from "@opencode/schema/buff-context-window"
import { Locale } from "./locale"

type SessionNode = {
  id: string
  parentID?: string | null
}

export function sessionFamily<T extends SessionNode>(sessions: readonly T[], sessionID: string) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const current = byID.get(sessionID)
  if (!current) return []

  const children = new Map<string, T[]>()
  sessions.forEach((session) => {
    if (!session.parentID) return
    const group = children.get(session.parentID)
    if (group) group.push(session)
    else children.set(session.parentID, [session])
  })

  function root(session: T): T {
    const parent = session.parentID ? byID.get(session.parentID) : undefined
    return parent ? root(parent) : session
  }

  function walk(parentID: string, ancestors: boolean[]): Array<{ session: T; prefix: string }> {
    const group = children.get(parentID) ?? []
    return group.flatMap((session, index) => {
      const last = index === group.length - 1
      const prefix =
        ancestors.length === 0
          ? ""
          : ancestors
              .slice(1)
              .map((ancestor) => (ancestor ? "   " : "│  "))
              .join("") + (last ? "└─ " : "├─ ")
      return [{ session, prefix }, ...walk(session.id, [...ancestors, last])]
    })
  }

  return walk(root(current).id, [])
}

export function lastAssistantWithUsage(messages: ReadonlyArray<SessionMessageInfo>, boundary?: string) {
  const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1
  if (boundary && boundaryIndex === -1) return undefined
  const end = boundaryIndex === -1 ? messages.length : boundaryIndex
  const compactionIndex = messages.findLastIndex(
    (message, index) => message.type === "compaction" && message.status === "completed" && index < end,
  )
  return messages.findLast(
    (message, index): message is SessionMessageAssistant & { tokens: NonNullable<SessionMessageAssistant["tokens"]> } =>
      message.type === "assistant" && message.tokens !== undefined && index > compactionIndex && index < end,
  )
}

/** The session's context use: tokens and the percent of the limit in force — the model's window cut by the session's cap (#837). */
export function contextUsage(
  messages: ReadonlyArray<SessionMessageInfo>,
  models: ReadonlyArray<ModelInfo> | undefined,
  boundary?: string,
  cap?: number,
) {
  const last = lastAssistantWithUsage(messages, boundary)
  if (!last) return
  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  if (tokens <= 0) return
  const model = models?.find((model) => model.providerID === last.model.providerID && model.id === last.model.id)
  const limit = BuffContextWindow.effective(model?.limit.context, cap)
  return {
    tokens,
    percent: limit ? Math.round((tokens / limit) * 100) : undefined,
  }
}

/** The prompt's cap label (#837): the cap in short, only when it is below the model's window. */
export function contextCapLabel(cap: number | undefined, modelWindow: number | undefined) {
  if (!cap) return undefined
  if (modelWindow !== undefined && cap >= modelWindow) return undefined
  return BuffContextWindow.format(cap)
}

/** The timeline row for a changed context cap (#837): the limit now in force, in words. */
export function contextSwitchText(
  message: { limit?: { context: number } },
  t: (text: string, params?: Record<string, string | number>) => string,
) {
  return t("Context limit: {limit}", { limit: BuffContextWindow.label(message.limit?.context, undefined, t) })
}

export function formatContextUsage(tokens: number, percent?: number) {
  const value = Locale.number(tokens)
  return percent === undefined ? value : `${value} (${percent}%)`
}
