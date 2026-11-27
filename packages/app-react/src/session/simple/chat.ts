// The session's messages as the shared chat logic reads them (#972). The simple layout draws a
// chat with the web client's turn — `foldChat` and `TurnView` of @buff/ui — and those read a
// chat as a machine hands it to a phone or a browser. The engine stores the same shapes, so this
// is a narrowing, not a translation: the kinds a turn is made of pass, the window's own marks
// (a model or an agent chosen, a location switched) do not make rows there.

import type { MessageRec, PartRec } from "@buff/ui/chat-logic"
import { parseCommentNote, readPromptPresentation } from "@opencode/app/react-reuse/comment-note"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import type { SessionTurnFailure } from "@opencode/session-ui/actions"
import { locationKey, type DataState } from "../../core/data/state"

type Assistant = Extract<MessageRec, { type: "assistant" }>

/** What is still being written: the last text or reasoning of an answer that has not ended. */
function parts(message: SessionMessageAssistant, live: boolean): PartRec[] {
  const last = message.content.length - 1
  return message.content.map((part, i): PartRec => {
    const streaming = live && i === last && !message.time.completed
    if (part.type === "text") return { type: "text", text: part.text, ...(streaming ? { streaming } : {}) }
    if (part.type === "reasoning")
      return {
        type: "reasoning",
        text: part.text,
        ...(part.time ? { time: part.time } : {}),
        ...(streaming ? { streaming } : {}),
      }
    return {
      type: "tool",
      id: part.id,
      name: part.name,
      state: {
        status: part.state.status,
        ...("input" in part.state ? { input: part.state.input } : {}),
        ...("content" in part.state && part.state.content ? { content: part.state.content } : {}),
        ...("error" in part.state ? { error: part.state.error } : {}),
        ...("metadata" in part.state && part.state.metadata ? { metadata: part.state.metadata } : {}),
      },
      time: part.time,
    }
  })
}

/**
 * A request as the person wrote it. What the model was sent carries notes for the model — «The
 * user made the following comment regarding lines 3 through 9 of …», «Attached file: …»; the
 * window keeps the person's own text beside it, with the comments and the files sent by path.
 */
export function requestText(message: SessionMessageUser): string {
  const shown = readPromptPresentation(message.metadata)
  const parsed = shown ? undefined : parseCommentNote(message.text)
  const comments = shown?.comments ?? (parsed ? [parsed] : [])
  const lines = [
    ...(shown?.attachments ?? []).map((file) => file.name),
    ...comments.map((comment) => {
      const at = comment.selection
      const where = at ? `:${at.startLine}${at.endLine !== at.startLine ? `–${at.endLine}` : ""}` : ""
      return `${comment.path}${where} — ${comment.comment}`
    }),
  ]
  const text = shown ? shown.displayText : parsed ? "" : message.text
  return [text, ...lines].filter((part) => part !== "").join("\n")
}

/**
 * A command of the person's own shell («!»): the command as a request, its output as the one
 * step of the answer. It ends by itself — no turn of the agent's follows it.
 */
function shell(message: Extract<SessionMessageInfo, { type: "shell" }>): MessageRec[] {
  const done = message.status !== "running"
  // A command that ended with a code other than 0 did not do its work: the step says so.
  const failed = done && (message.status !== "exited" || (message.exit !== undefined && message.exit !== 0))
  return [
    { type: "user", id: message.id, text: `! ${message.command}`, time: { created: message.time.created } },
    {
      type: "assistant",
      id: `${message.id}:shell`,
      content: [
        {
          type: "tool",
          id: message.shellID,
          name: "bash",
          state: {
            status: !done ? "running" : failed ? "error" : "completed",
            input: { command: message.command },
            ...(failed && message.status === "exited" ? { error: { message: `exit ${message.exit}` } } : {}),
            ...(message.output?.output ? { content: [{ type: "text", text: message.output.output }] } : {}),
          },
          time: {
            created: message.time.created,
            ran: message.time.created,
            ...(message.time.completed ? { completed: message.time.completed } : {}),
          },
        },
      ],
      time: message.time,
    },
    ...(done
      ? [
          {
            type: "idle" as const,
            id: `${message.id}:end`,
            outcome: message.status === "exited" ? ("succeeded" as const) : ("interrupted" as const),
            time: { created: message.time.completed ?? message.time.created },
          },
        ]
      : []),
  ]
}

/** Whether a turn's request is a message of the person's to the agent — not a shell command. */
export function isRequest(messages: readonly SessionMessageInfo[], id: string): boolean {
  return messages.some((message) => message.id === id && message.type === "user")
}

function assistant(message: SessionMessageAssistant, live: boolean): Assistant {
  return {
    type: "assistant",
    id: message.id,
    content: parts(message, live),
    model: { id: message.model.id, providerID: message.model.providerID },
    ...(message.error ? { error: message.error } : {}),
    time: message.time,
    ...(message.tokens
      ? { tokens: { input: message.tokens.input, output: message.tokens.output, reasoning: message.tokens.reasoning } }
      : {}),
  }
}

/**
 * `running` — the session is at work: the newest answer's last part is then still being written.
 * The messages are the visible ones (what a staged rewind hides is already out).
 */
export function toChat(messages: readonly SessionMessageInfo[], running: boolean): MessageRec[] {
  const newest = messages.findLast((message) => message.type === "assistant")
  return messages.flatMap((message): MessageRec[] => {
    switch (message.type) {
      case "user":
        return [
          {
            type: "user",
            id: message.id,
            text: requestText(message),
            ...(message.files?.length
              ? {
                  files: message.files.map((file) => ({
                    mime: file.mime,
                    data: file.data,
                    ...(file.name ? { name: file.name } : {}),
                    // A file only mentioned in the text is not an attachment: the fold leaves it out.
                    ...(file.mention ? { mention: file.mention } : {}),
                  })),
                }
              : {}),
            time: message.time,
          },
        ]
      case "assistant":
        return [assistant(message, running && message === newest)]
      case "synthetic":
        return [
          {
            type: "synthetic",
            id: message.id,
            text: message.text,
            ...(message.description ? { description: message.description } : {}),
            ...(message.metadata ? { metadata: message.metadata as Record<string, string> } : {}),
            time: message.time,
          },
        ]
      case "compaction":
        return [
          {
            type: "compaction",
            id: message.id,
            status: message.status,
            ...("summary" in message && message.summary ? { summary: message.summary } : {}),
            time: message.time,
          },
        ]
      case "idle":
        return [{ type: "idle", id: message.id, outcome: message.outcome, time: message.time }]
      case "context-switched":
        return [
          {
            type: "context-switched",
            id: message.id,
            ...(message.limit ? { limit: message.limit } : {}),
            time: message.time,
          },
        ]
      case "shell":
        return shell(message)
      default:
        return []
    }
  })
}

/**
 * A failed turn as the window's failure card takes it: the error the model's answer ended with,
 * its provider and model, the request it answered and that request's files. Undefined — the
 * turn has no failed answer among the messages (it was only stopped, or they are not read yet).
 */
export function failureOf(
  turn: { user?: { id: string } },
  messages: readonly SessionMessageInfo[],
): SessionTurnFailure | undefined {
  if (!turn.user) return undefined
  const from = messages.findIndex((message) => message.id === turn.user!.id)
  if (from < 0) return undefined
  const request = messages[from]
  const until = messages.findIndex((message, i) => i > from && message.type === "user")
  const failed = messages
    .slice(from + 1, until < 0 ? undefined : until)
    .findLast((message): message is SessionMessageAssistant => message.type === "assistant" && !!message.error)
  if (!failed?.error) return undefined
  const files = request?.type === "user" ? request.files : undefined
  return {
    userMessageID: turn.user.id,
    providerID: failed.model.providerID,
    type: failed.error.type,
    message: failed.error.message,
    ...(failed.error.status !== undefined ? { status: failed.error.status } : {}),
    ...(files?.length
      ? { attachments: files.map((file) => ({ mime: file.mime, ...(file.name ? { name: file.name } : {}) })) }
      : {}),
    modelID: failed.model.id,
  }
}

/** The models of the session's location by id, as the catalog names them. */
export function modelNames(state: DataState, sessionID: string): ReadonlyMap<string, string> {
  const location = state.session.info[sessionID]?.location ?? state.defaultLocation
  const models = state.location[locationKey(location)]?.model ?? []
  return new Map(models.flatMap((model) => (model.name ? [[model.id, model.name] as const] : [])))
}

/**
 * Whether asking a request again may REPLACE what followed it: only the chat's last request
 * (nothing of the person's came after — no later request, no shell command) and only while no
 * rewind is staged. Asking an older one again in place would take the later turns with it.
 */
export function replaceable(messages: readonly SessionMessageInfo[], staged: boolean, id: string): boolean {
  if (staged) return false
  return messages.findLast((message) => message.type === "user" || message.type === "shell")?.id === id
}

/**
 * What the chat ends with — to tell, on coming back to a tab, whether the agent wrote meanwhile.
 * The last message and how much it holds; not how many messages there are — an earlier page
 * read in above is no news below.
 */
export function tail(messages: readonly SessionMessageInfo[]): string {
  const last = messages.at(-1)
  if (!last) return ""
  if (last.type === "shell") return `${last.id}:${last.status}:${last.output?.size ?? 0}`
  if (last.type !== "assistant") return last.id
  const held = last.content.map((part) => ("text" in part ? part.text.length : part.state.status)).join(",")
  return `${last.id}:${held}`
}
