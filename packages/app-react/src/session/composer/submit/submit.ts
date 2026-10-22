// Sending what the composer holds (#584), ported from the Solid composer's submit.ts: a prompt
// (applying the chosen agent and model first when it steers), a slash command or a shell command,
// to a running session or to the session a new-session draft starts. A failed send puts the
// prompt back and says why.

import { blobDataUrl, resolveBlobUrl } from "@opencode/app/react-reuse/drafts"
import { clonePrompt, promptLength, isAttachment } from "@opencode/app/react-reuse/composer-prompt-parts"
import { buildPromptRequest } from "@opencode/app/react-reuse/composer-request"
import type { ImageAttachmentPart, Prompt } from "@opencode/app/react-reuse/composer-schema"
import type { PromptHistoryComment } from "@opencode/app/react-reuse/composer-history-entry"
import { SessionMessage } from "@opencode/schema/session-message"
import type { OpenCodeClient, SessionMessageUser } from "@opencode/client/promise"
import { setCursorPosition } from "@opencode/app/react-reuse/composer-dom"
import type { ComposerDraft } from "../draft/draft"
import type { ComposerDelivery } from "../editor/controller"
import { createSubmission, type Submission } from "./submission"

type SessionApi = OpenCodeClient["session"]

export type ComposerSelection = { agent: string; model: { providerID: string; modelID: string }; variant?: string }

/** The session a send goes to. */
export type ComposerSession = {
  id: string
  directory: string
  api: Pick<SessionApi, "command" | "shell" | "switchAgent" | "switchModel">
  prompt(input: Parameters<SessionApi["prompt"]>[0]): Promise<unknown>
  setStatus(status: "idle" | "running"): void
  current(): { agent?: string; model?: { id: string; providerID: string; variant?: string } } | undefined
  admitted(messageID: string): boolean
}

type AdapterBase = {
  draft: ComposerDraft
  working(): boolean
  submitted(): void
  /** The pick a send applies; undefined when no model or agent is available. */
  selection(): ComposerSelection | undefined
  /** Hold the local pick until the server confirms it (see models/use-selection.ts). */
  track?(sessionID: string, selection: ComposerSelection): () => void
}

export type ComposerAdapter =
  | (AdapterBase & { kind: "active-session"; session(): ComposerSession; interrupt(): Promise<void> })
  | (AdapterBase & {
      kind: "new-session"
      start(
        selection: ComposerSelection,
        submission: Submission,
        message: SessionMessageUser,
      ): Promise<
        | {
            session: ComposerSession
            complete?: () => Promise<void>
            /** The send was no prompt (a command, a shell): the first prompt shown while preparing goes. */
            discard?: () => void
          }
        | undefined
      >
    })

export type SubmitInput = {
  adapter: ComposerAdapter
  mode: () => "normal" | "shell"
  commands: () => readonly { name: string }[] | undefined
  editor: () => HTMLElement | undefined
  addToHistory(prompt: Prompt, mode: "normal" | "shell"): void
  removeFromHistory(prompt: Prompt, mode: "normal" | "shell", comments: PromptHistoryComment[]): void
  resetHistory(): void
  setMode(mode: "normal" | "shell"): void
  closePopover(): void
  delivery(alternate: boolean): ComposerDelivery
  notify: { missingSelection(): void; failed(kind: "shell" | "command" | "prompt", error: unknown): void }
  comments: { capture(): PromptHistoryComment[]; clear(): void; restore(comments: PromptHistoryComment[]): void }
}

type Value = {
  id: string
  mode: "normal" | "shell"
  prompt: Prompt
  context: Submission["context"]
  text: string
  images: ImageAttachmentPart[]
  selection: ComposerSelection
  delivery: ComposerDelivery
}

const submitting = new WeakSet<object>()

export function createComposerSubmit(input: SubmitInput) {
  const submit = async (options?: { alternate?: boolean }) => {
    const adapter = input.adapter
    const draft = adapter.draft
    const submission = createSubmission({
      target: draft,
      prompt: clonePrompt(draft.current()),
      context: draft.contextItems().map((item) => ({ ...item, selection: item.selection && { ...item.selection } })),
    })
    const read = readSubmission(input, submission, options?.alternate ?? false)
    if (!read) {
      if (adapter.working() && adapter.kind === "active-session") void adapter.interrupt()
      return
    }
    if (submitting.has(draft)) return
    // Images restored from a draft or history carry ids only; the optimistic message shows their URLs.
    const images = await Promise.all(
      read.images.map(async (image) => ({
        ...image,
        blob: { ...image.blob, url: (await resolveBlobUrl(image.blob)) ?? image.blob.url },
      })),
    )
    const value = { ...read, images }
    submitting.add(draft)
    const comments = input.comments.capture()
    // Capture command intent before starting a session whose command catalog has not loaded.
    const command = value.mode === "normal" ? findCommand(input.commands(), value.text) : undefined
    try {
      const started =
        adapter.kind === "active-session"
          ? { session: adapter.session(), complete: undefined }
          : await adapter.start(value.selection, submission, handoffMessage(value))
      if (!started) return
      const session = started.session
      input.addToHistory(value.prompt, value.mode)
      input.resetHistory()
      const restore = () => restoreSubmission(input, submission, value, comments)

      if (value.mode === "normal" && !command) {
        const optimistic = !adapter.working()
        if (optimistic && adapter.kind === "new-session") session.setStatus("running")
        const sending = sendPrompt(session, value, adapter.track, () => {
          if (optimistic && adapter.kind === "active-session") session.setStatus("running")
        }).then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        )
        await started.complete?.()
        adapter.submitted()
        submission.context
          .filter((item) => !!item.comment?.trim())
          .forEach((item) => submission.target().context.remove(item.key))
        input.comments.clear()
        clearSubmission(input, submission)
        void sending.then((result) => {
          if (result.ok) return
          failSubmission(input, session, "prompt", result.error, restore, value.id, () => {
            if (optimistic) session.setStatus("idle")
          })
        })
        return
      }

      await started.complete?.()
      if ("discard" in started) started.discard?.()
      adapter.submitted()
      clearSubmission(input, submission)
      if (value.mode === "shell") {
        void session.api
          .shell({ sessionID: session.id, id: value.id, command: value.text })
          .catch((error: unknown) => failSubmission(input, session, "shell", error, restore))
        return
      }
      if (command)
        void sendCommand(session, value, command, adapter.track).catch((error: unknown) =>
          failSubmission(input, session, "command", error, restore, value.id),
        )
    } finally {
      submitting.delete(draft)
    }
  }
  return {
    submit,
    stop: () => (input.adapter.kind === "active-session" ? input.adapter.interrupt() : Promise.resolve()),
  }
}

function readSubmission(input: SubmitInput, submission: Submission, alternate: boolean): Value | undefined {
  const prompt = submission.prompt
  const text = prompt.map((part) => ("content" in part ? part.content : "")).join("")
  const mode = input.mode()
  if (mode === "shell" && !text.trim()) return
  const images = prompt.filter((part): part is ImageAttachmentPart => part.type === "image")
  const comments = submission.context.filter((item) => !!item.comment?.trim()).length
  if (!text.trim() && !prompt.some(isAttachment) && comments === 0) return
  const selection = input.adapter.selection()
  if (!selection) {
    input.notify.missingSelection()
    return
  }
  const retry = input.adapter.draft.retry()
  const retryID =
    retry &&
    retry.agent === selection.agent &&
    retry.providerID === selection.model.providerID &&
    retry.modelID === selection.model.modelID &&
    (retry.variant ?? "default") === (selection.variant ?? "default")
      ? retry.id
      : undefined
  return {
    id: retryID ?? SessionMessage.ID.create(),
    mode,
    prompt,
    context: submission.context,
    text,
    images,
    selection,
    delivery: input.delivery(alternate),
  }
}

function handoffMessage(value: Value): SessionMessageUser {
  return {
    id: value.id,
    type: "user",
    text: value.text,
    files: value.images.map((image) => ({
      data: "",
      mime: image.mime,
      source: { type: "uri", uri: image.blob.url },
      name: image.sourcePath ?? image.filename,
    })),
    metadata: {
      displayText: value.text,
      attachments: value.prompt.flatMap((part) =>
        part.type === "path" ? [{ name: part.filename, mime: part.mime, path: part.path }] : [],
      ),
      comments: value.context.flatMap((item) =>
        item.comment?.trim()
          ? [
              {
                path: item.path,
                comment: item.comment.trim(),
                ...(item.selection ? { selection: { ...item.selection } } : {}),
                ...(item.preview !== undefined ? { preview: item.preview } : {}),
                ...(item.commentOrigin ? { origin: item.commentOrigin } : {}),
              },
            ]
          : [],
      ),
      agent: value.selection.agent,
      model: { ...value.selection.model, ...(value.selection.variant ? { variant: value.selection.variant } : {}) },
    },
    time: { created: Date.now() },
  } as SessionMessageUser
}

function clearSubmission(input: SubmitInput, submission: Submission) {
  submission.clear()
  submission.target().setMode("normal")
  input.setMode("normal")
  input.closePopover()
}

function restoreSubmission(input: SubmitInput, submission: Submission, value: Value, comments: PromptHistoryComment[]) {
  const restored = submission.restore()
  if (!restored) return false
  // The prompt is back in the composer; its history entry would only keep attachments referenced.
  input.removeFromHistory(value.prompt, value.mode, comments)
  restored.target.set(restored.prompt, promptLength(restored.prompt))
  restored.target.setMode(value.mode)
  restored.target.context.replaceComments(
    restored.context
      .filter((item) => !!item.comment?.trim())
      .map((item) => ({
        type: "file",
        path: item.path,
        selection: item.selection,
        comment: item.comment,
        commentID: item.commentID,
        commentOrigin: item.commentOrigin,
        preview: item.preview,
      })),
  )
  // A recovered follow-up changes the payload, so it must use a new admission id.
  if (value.mode === "normal" && restored.prompt === submission.prompt)
    restored.target.setRetry({
      id: value.id as SessionMessage.ID,
      agent: value.selection.agent,
      providerID: value.selection.model.providerID,
      modelID: value.selection.model.modelID,
      variant: value.selection.variant,
    })
  if (!submission.current(input.adapter.draft)) return true
  input.comments.restore(comments)
  input.setMode(value.mode)
  input.closePopover()
  requestAnimationFrame(() => {
    const editor = input.editor()
    if (!editor) return
    editor.focus()
    setCursorPosition(editor, promptLength(value.prompt))
    editor.scrollIntoView({ block: "nearest" })
  })
  return true
}

function findCommand(commands: readonly { name: string }[] | undefined, text: string) {
  if (!text.startsWith("/")) return
  const [name = "", ...rest] = text.split(" ")
  const command = name.slice(1)
  if (!commands?.some((item) => item.name === command)) return
  return { command, arguments: rest.join(" ") }
}

async function applySelection(
  session: ComposerSession,
  selection: ComposerSelection,
  track?: ComposerAdapter["track"],
) {
  const cancel = track?.(session.id, selection)
  try {
    if (session.current()?.agent !== selection.agent)
      await session.api.switchAgent({ sessionID: session.id, agent: selection.agent })
    // The server deduplicates unchanged selections; cached state may still be behind an earlier switch.
    await session.api.switchModel({
      sessionID: session.id,
      model: { id: selection.model.modelID, providerID: selection.model.providerID, variant: selection.variant },
    })
  } catch (error) {
    cancel?.()
    throw error
  }
}

async function buildRequest(session: ComposerSession, value: Value) {
  const images = await Promise.all(
    value.images.map(async (image) => ({ ...image, dataUrl: await blobDataUrl(image.blob, image.mime) })),
  )
  return buildPromptRequest({
    prompt: value.prompt,
    context: value.context,
    images,
    text: value.text,
    sessionDirectory: session.directory,
  })
}

async function sendCommand(
  session: ComposerSession,
  value: Value,
  command: { command: string; arguments: string },
  track?: ComposerAdapter["track"],
) {
  const request = await buildRequest(session, value)
  // Like queued prompts, queued commands must not apply the composer's selection to active work.
  if (value.delivery === "steer") await applySelection(session, value.selection, track)
  await session.api.command({
    sessionID: session.id,
    name: command.command,
    text: command.arguments,
    files: request.files.map((file) => ({ uri: file.uri, name: file.name, mention: file.mention })),
    agents: request.agents,
    skills: request.skills,
    delivery: value.delivery,
  })
}

async function sendPrompt(
  session: ComposerSession,
  value: Value,
  track: ComposerAdapter["track"],
  onAdmit: () => void,
) {
  const request = await buildRequest(session, value)
  // A steer targets the running turn, so its selection applies now; a queued follow-up must not
  // reconfigure the turn it waits behind (its intended selection stays in its metadata).
  if (value.delivery === "steer") await applySelection(session, value.selection, track)
  const admission = {
    id: value.id,
    sessionID: session.id,
    delivery: value.delivery,
    text: request.text,
    files: request.files.map((file) => ({ uri: file.uri, name: file.name, mention: file.mention })),
    agents: request.agents,
    skills: request.skills,
    metadata: {
      displayText: request.displayText,
      comments: request.comments,
      attachments: request.attachments,
      agent: value.selection.agent,
      model: { ...value.selection.model, ...(value.selection.variant ? { variant: value.selection.variant } : {}) },
    },
  }
  const sending = session.prompt(admission).catch(() => session.prompt(admission))
  onAdmit()
  await sending
}

function failSubmission(
  input: SubmitInput,
  session: ComposerSession,
  kind: "shell" | "command" | "prompt",
  error: unknown,
  restore: () => boolean,
  messageID?: string,
  rollback?: () => void,
) {
  if (messageID && session.admitted(messageID)) return
  rollback?.()
  restore()
  input.notify.failed(kind, error)
}
