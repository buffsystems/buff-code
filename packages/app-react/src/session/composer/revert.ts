// Rewinding a session to one of its prompts (#584), ported from the Solid session revert: stage
// the rewind (interrupting a running turn), drop the queue written against the rewound history,
// and put the rewound prompt back into the composer; redo moves the rewind forward or clears it.
// The timeline's «rewind to here» and Buff's «Bring it back» strip both use it.

import { extractPromptComments, extractPromptFromMessage } from "@opencode/app/react-reuse/composer-prompt"
import type { SessionMessageUser } from "@opencode/client/promise"
import type { Server } from "../../core/servers"
import type { ComposerDraft } from "./draft/draft"

export type RevertInput = {
  server: Server
  sessionID: string
  directory: string
  draft: ComposerDraft
  notify(error: unknown): void
  /** Buff (#449): ask before rewinding — what comes back and whether files are restored; undefined cancels. */
  confirm?(message: SessionMessageUser): Promise<{ files: boolean } | undefined>
  setActiveMessage?(message: SessionMessageUser | undefined): void
}

export function createSessionRevert(input: RevertInput) {
  const data = input.server.data
  const api = () => input.server.api().session
  const userMessages = () =>
    (data.state.get().session.message[input.sessionID] ?? []).filter(
      (message): message is SessionMessageUser => message.type === "user",
    )
  const revertedID = () => data.state.get().session.info[input.sessionID]?.revert?.messageID
  const request = (action: () => Promise<unknown>) =>
    action().then(
      () => true,
      (error: unknown) => {
        input.notify(error)
        return false
      },
    )

  const restore = (message: SessionMessageUser) => {
    input.draft.set(extractPromptFromMessage(message, { directory: input.directory }))
    input.draft.context.replaceComments(
      extractPromptComments(message).map((comment) => ({
        type: "file",
        path: comment.path,
        selection: comment.selection,
        comment: comment.comment,
        preview: comment.preview,
        commentOrigin: comment.origin,
      })),
    )
  }

  const stage = async (message: SessionMessageUser, previous: SessionMessageUser | undefined, ask = false) => {
    const sessionID = input.sessionID
    const choice = ask && input.confirm ? await input.confirm(message) : { files: true }
    if (!choice) return
    if (data.session.status(sessionID) === "running") await api().interrupt({ sessionID }).catch(() => undefined)
    if (!(await request(() => api().revert.stage({ sessionID, messageID: message.id, files: choice.files })))) return
    // The queue was written against the rewound history: cancel it (the local snapshot merged with
    // the server's), fire-and-forget, sparing prompts admitted after the rewind.
    const cutoff = Date.now()
    const local = data.session.pending
      .list(sessionID)
      .filter((item) => item.type === "user")
      .map((item) => item.id)
    void api()
      .inbox.list({ sessionID })
      .then((rows) => rows.filter((row) => row.type === "user" && row.time.created <= cutoff).map((row) => row.id))
      .catch(() => [])
      .then((server) =>
        new Set([...local, ...server]).forEach(
          (inboxID) => void api().inbox.cancel({ sessionID, inboxID }).catch(() => undefined),
        ),
      )
    restore(message)
    input.setActiveMessage?.(previous)
  }

  return {
    async to(messageID: string) {
      const messages = userMessages()
      const index = messages.findIndex((message) => message.id === messageID)
      const message = messages[index]
      if (message) await stage(message, messages[index - 1], true)
    },
    async undo() {
      const messages = userMessages()
      const reverted = revertedID()
      const boundary = reverted ? messages.findIndex((message) => message.id === reverted) : messages.length
      const message = boundary > 0 ? messages[boundary - 1] : undefined
      if (message) await stage(message, messages[boundary - 2], true)
    },
    async redo() {
      const reverted = revertedID()
      if (!reverted) return
      const messages = userMessages()
      const boundary = messages.findIndex((message) => message.id === reverted)
      if (boundary < 0) return
      const next = messages[boundary + 1]
      if (next) return stage(next, messages[boundary])
      if (!(await request(() => api().revert.clear({ sessionID: input.sessionID })))) return
      input.draft.reset()
      input.draft.context.replaceComments([])
      input.setActiveMessage?.(messages.at(-1))
    },
  }
}

export type SessionRevert = ReturnType<typeof createSessionRevert>
