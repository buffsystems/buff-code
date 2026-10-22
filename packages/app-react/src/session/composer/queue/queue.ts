// Prompts queued behind the running turn (#584), ported from the Solid session queue (queue.ts):
// the queue rows from the session's inbox, editing a queued prompt in the composer (the draft is
// stashed and comes back), re-admitting the edit in its place, steering, removing and reordering.

import { blobDataUrl, createLegacyBlobReference } from "@opencode/app/react-reuse/drafts"
import { readPromptPresentation } from "@opencode/app/react-reuse/comment-note"
import { clonePrompt, isAttachment, promptLength } from "@opencode/app/react-reuse/composer-prompt-parts"
import { buildPromptRequest } from "@opencode/app/react-reuse/composer-request"
import type { ImageAttachmentPart, PathAttachmentPart, Prompt } from "@opencode/app/react-reuse/composer-schema"
import type { SessionInboxInfo } from "@opencode/client/promise"
import { SessionMessage } from "@opencode/schema/session-message"
import { createStore } from "../../../core/store"
import type { Server } from "../../../core/servers"
import type { ComposerDraft, ComposerRetry } from "../draft/draft"
import type { ComposerDelivery, ComposerQueue } from "../editor/controller"

export type QueuedPrompt = Extract<SessionInboxInfo, { type: "user" }>

type EditStash = { prompt: Prompt; cursor: number; mode: "normal" | "shell"; retry?: ComposerRetry }

type Replacement = { original: string; replacement: string; delivery: ComposerDelivery }

export type QueueState = { editing?: { id: string; stash: EditStash }; busy: boolean; replacement?: Replacement }

export type QueueInput = {
  server: Server
  sessionID: string
  directory: () => string
  draft: ComposerDraft
  working: () => boolean
  behavior: () => ComposerDelivery
  restoreFocus(cursor: number): void
  notify(): void
}

export function queuedPrompts(items: SessionInboxInfo[] | undefined) {
  return (items ?? []).filter((item): item is QueuedPrompt => item.type === "user" && item.delivery === "queue")
}

export function createSessionQueue(input: QueueInput) {
  const state = createStore<QueueState>({ busy: false })
  const api = () => input.server.api().session
  const data = input.server.data
  const queued = () => queuedPrompts(data.state.get().session.pending[input.sessionID])

  const run = async (work: () => Promise<void>, replacement?: Replacement) => {
    if (state.get().busy) return
    state.set((current) => ({ ...current, busy: true, replacement }))
    try {
      await work()
    } catch {
      input.notify()
    } finally {
      state.set((current) => ({ ...current, busy: false, replacement: undefined }))
      void data.session.pending.sync(input.sessionID).catch(() => undefined)
    }
  }

  // The inbox cannot reorder rows, so the changed suffix is re-admitted and the old rows cancelled.
  const rewrite = async (inboxIDs: string[]) => {
    const pending = await api().inbox.list({ sessionID: input.sessionID })
    if (pending.some((item) => item.delivery === "queue" && item.type !== "user"))
      throw new Error("Queued control items block reordering")
    const current = queuedPrompts(pending)
    const ordered = inboxIDs.flatMap((id) => current.filter((item) => item.id === id))
    if (ordered.length !== current.length) throw new Error("Queued prompts changed before reordering")
    const changed = ordered.findIndex((item, index) => item.id !== current[index]?.id)
    if (changed < 0) return
    for (const item of ordered.slice(changed)) {
      await data.session.prompt({
        sessionID: input.sessionID,
        text: item.payload.text,
        files: item.payload.files?.map((file) => ({
          uri: `data:${file.mime};base64,${file.data}`,
          name: file.name,
          description: file.description,
          mention: file.mention,
        })),
        agents: item.payload.agents,
        skills: item.payload.skills,
        metadata: item.payload.metadata,
        delivery: "queue",
        resume: false,
      })
    }
    for (const item of current.slice(changed)) await api().inbox.cancel({ sessionID: input.sessionID, inboxID: item.id })
  }

  const cancelEdit = () => {
    const editing = state.get().editing
    if (!editing) return
    state.set((current) => ({ ...current, editing: undefined }))
    // Mode first, then prompt, then retry: mode and prompt writes both clear the retry marker.
    input.draft.setMode(editing.stash.mode)
    input.draft.set(editing.stash.prompt, editing.stash.cursor)
    if (editing.stash.retry) input.draft.setRetry(editing.stash.retry)
    input.restoreFocus(editing.stash.cursor)
  }

  const edit = (id: string) => {
    if (state.get().busy) return false
    if (state.get().editing?.id === id) return true
    const item = queued().find((entry) => entry.id === id)
    if (!item) return false
    if (state.get().editing) cancelEdit()
    const draft = input.draft.current()
    const stash = {
      prompt: clonePrompt(draft),
      cursor: input.draft.cursor() ?? promptLength(draft),
      mode: input.draft.mode(),
      retry: input.draft.retry(),
    }
    state.set((current) => ({ ...current, editing: { id, stash } }))
    const text = queuedPromptText(item)
    input.draft.setMode("normal")
    input.draft.set([{ type: "text", content: text, start: 0, end: text.length }, ...queuedPromptAttachments(item)], text.length)
    input.restoreFocus(text.length)
    return true
  }

  const confirmEdit = (delivery: ComposerDelivery) => {
    const editing = state.get().editing
    if (!editing || state.get().busy) return
    const prompt = clonePrompt(input.draft.current())
    const text = prompt.map((part) => ("content" in part ? part.content : "")).join("")
    const attachments = prompt.filter(isAttachment)
    if (!text.trim() && !attachments.length) return cancelEdit()
    const item = queued().find((entry) => entry.id === editing.id)
    const original = item ? queuedPromptAttachments(item) : []
    const pristine =
      item &&
      text.trim() === queuedPromptText(item) &&
      attachments.length === original.length &&
      attachments.every((attachment, index) => attachment.id === original[index]?.id)
    if (pristine && delivery === "queue") return cancelEdit()
    const inboxIDs = queued().map((entry) => entry.id)
    const replacementID = SessionMessage.ID.create()
    void run(
      async () => {
        const replacement = await editedPromptInput(input.sessionID, input.directory(), item, prompt, text)
        // Admit before cancelling so a failed replacement never discards the original.
        await data.session.prompt({
          ...replacement,
          id: replacementID,
          delivery,
          ...(delivery === "queue" ? { resume: false } : {}),
        })
        await api().inbox.cancel({ sessionID: input.sessionID, inboxID: editing.id })
        cancelEdit()
        if (delivery === "queue") await rewrite(inboxIDs.map((id) => (id === editing.id ? replacementID : id)))
      },
      { original: editing.id, replacement: replacementID, delivery },
    )
  }

  // An edited row whose original left the queue (delivered, cancelled) ends the edit.
  const stop = data.state.subscribe(() => {
    const editing = state.get().editing
    if (!editing || state.get().busy || queued().some((item) => item.id === editing.id)) return
    state.set((current) => ({ ...current, editing: undefined }))
  })

  const queue: ComposerQueue & {
    state: typeof state
    steer(id: string): Promise<unknown>
    remove(id: string): Promise<unknown>
    edit(id: string): boolean
    reorder(ids: string[]): Promise<void>
    dispose(): void
  } = {
    state,
    count: () => queued().length,
    delivery: () => (input.working() ? input.behavior() : "steer"),
    alternate: () => {
      if (state.get().editing) return "steer"
      if (!input.working()) return undefined
      return input.behavior() === "queue" ? "steer" : "queue"
    },
    editing: () => state.get().editing?.id,
    confirmEdit,
    cancelEdit,
    editFirst: () => {
      const first = queued()[0]
      return first ? edit(first.id) : false
    },
    edit,
    steer(id) {
      if (state.get().editing?.id === id) cancelEdit()
      return api()
        .inbox.update({ sessionID: input.sessionID, inboxID: id, delivery: "steer" })
        .catch(() => input.notify())
    },
    remove(id) {
      if (state.get().editing?.id === id) cancelEdit()
      return api()
        .inbox.cancel({ sessionID: input.sessionID, inboxID: id })
        .catch(() => input.notify())
    },
    reorder: (ids) => run(() => rewrite(ids)),
    dispose() {
      stop()
      cancelEdit()
    },
  }
  return queue
}

export type SessionQueue = ReturnType<typeof createSessionQueue>

export function queuedPromptRows(items: QueuedPrompt[], replacement?: { original: string; replacement: string }) {
  const replaced = replacement && items.some((item) => item.id === replacement.replacement)
  return items
    .filter((item) => !replaced || item.id !== replacement.original)
    .map((item) => ({
      id: item.id,
      text: queuedPromptText(item),
      attachments:
        (item.payload.files?.length ?? 0) + (readPromptPresentation(item.payload.metadata)?.attachments.length ?? 0),
    }))
}

export function queuedPromptText(item: QueuedPrompt) {
  const display = item.payload.metadata?.["displayText"]
  return typeof display === "string" && display.length > 0 ? display : item.payload.text
}

// Inline attachments return to the composer as images an edit can remove or extend, path
// references as paths; mentions and `file://` context stay in the payload (editedPromptInput).
export function queuedPromptAttachments(item: QueuedPrompt): (ImageAttachmentPart | PathAttachmentPart)[] {
  return [
    ...(item.payload.files ?? []).filter(isComposerAttachment).map(
      (file, index): ImageAttachmentPart => ({
        type: "image",
        id: `${item.id}:file:${index}`,
        filename: file.name ?? "attachment",
        mime: file.mime,
        blob: createLegacyBlobReference(`data:${file.mime};base64,${file.data}`),
      }),
    ),
    ...(readPromptPresentation(item.payload.metadata)?.attachments ?? []).map(
      (file, index): PathAttachmentPart => ({
        type: "path",
        id: `${item.id}:path:${index}`,
        filename: file.name,
        mime: file.mime,
        path: file.path,
      }),
    ),
  ]
}

function isComposerAttachment(file: NonNullable<QueuedPrompt["payload"]["files"]>[number]) {
  return !file.mention && file.source.type === "inline"
}

// The edit is the composer's content parsed like a normal send; stored mentions and context
// files the composer cannot show are kept, and the review notes appended to the original survive.
async function editedPromptInput(
  sessionID: string,
  directory: string,
  item: QueuedPrompt | undefined,
  prompt: Prompt,
  text: string,
) {
  const images = await Promise.all(
    prompt
      .filter((part): part is ImageAttachmentPart => part.type === "image")
      .map(async (part) => ({ ...part, dataUrl: await blobDataUrl(part.blob, part.mime) })),
  )
  const request = buildPromptRequest({ prompt, context: [], images, text, sessionDirectory: directory })
  const payload = item?.payload
  const display = item ? queuedPromptText(item) : ""
  const notes = payload && display && payload.text.startsWith(display) ? payload.text.slice(display.length) : ""
  const mention = (value: { start: number; end: number; text: string } | undefined) => {
    if (!value) return undefined
    const start = text.indexOf(value.text)
    if (start < 0) return undefined
    return { text: value.text, start, end: start + value.text.length }
  }
  const agents = [
    ...(payload?.agents?.filter(
      (agent) =>
        agent.mention && text.includes(agent.mention.text) && !request.agents.some((entry) => entry.name === agent.name),
    ) ?? []),
    ...request.agents,
  ]
  const skills = [
    ...(payload?.skills?.filter(
      (skill) => skill.mention && text.includes(skill.mention.text) && !request.skills.some((entry) => entry.id === skill.id),
    ) ?? []),
    ...request.skills,
  ]
  return {
    sessionID,
    text: request.text + notes,
    files: [
      ...(payload?.files
        ?.filter((file) => !isComposerAttachment(file))
        .map((file) => ({
          uri: `data:${file.mime};base64,${file.data}`,
          name: file.name,
          description: file.description,
          mention: mention(file.mention),
        })) ?? []),
      ...request.files.map((file) => ({ uri: file.uri, name: file.name, mention: file.mention })),
    ],
    agents: agents.map((agent) => ({ name: agent.name, mention: mention(agent.mention) })),
    skills: skills.map((skill) => ({ id: skill.id, mention: mention(skill.mention) })),
    metadata: { ...payload?.metadata, displayText: request.displayText, attachments: request.attachments },
  }
}
