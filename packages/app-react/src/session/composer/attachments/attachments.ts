// Files the composer takes (#584), ported from the Solid composer's attachments.ts: media the model
// reads natively travel inline (their bytes in the draft store), everything else reaches the model
// as a path on the server — the file's own path when the server shares this filesystem, else an
// upload into the server's temporary directory, shown as a chip with its progress.

import { BuffComposerParts } from "@opencode/schema/buff-composer-parts"
import { createBlobReference } from "@opencode/app/react-reuse/drafts"
import type { ImageAttachmentPart, PathAttachmentPart } from "@opencode/app/react-reuse/composer-schema"
import { createStore } from "../../../core/store"
import type { ComposerDraft } from "../draft/draft"
import { uploads, type Upload } from "./uploads"

export type AttachmentDestination = {
  /** Input modalities the selected model reads natively. */
  input: { image: boolean; pdf: boolean }
  /** The server shares the client's filesystem, so a source path resolves as is. */
  local: boolean
  /** Streams a file into the server's temporary directory and returns its absolute path there. */
  upload(file: File, report: (loaded: number) => void, signal: AbortSignal): Promise<string>
}

export type AttachmentsInput = {
  draft: ComposerDraft
  destination(): AttachmentDestination
  directory(): string
  picker?(options: { defaultPath?: string; multiple?: boolean }, onFile: (file: File) => Promise<unknown>): Promise<void>
  getPathForFile?(file: File): string
  readClipboardImage?(): Promise<File | null>
  onDragCancel?(callback: () => void): () => void
  store?(file: File): Promise<{ id: string; url: string }>
  isDialogActive(): boolean
  focusEditor(): void
  setDragging(active: boolean): void
  duplicate(): void
  onError(error: unknown): void
  onUploadError(error: unknown): void
}

// Buff (#459): files picked in this window, for their preview while it stays open.
const pickedFiles = new Map<string, File>()
export const pickedFile = (id: string) => pickedFiles.get(id)

export function createAttachments(input: AttachmentsInput) {
  const draft = input.draft
  const pending = createStore<string[]>([])
  const staged = new Map<string, string | undefined>()

  const add = async (file: File, clipboard = false) => {
    const mime = await attachmentMime(file)
    const destination = input.destination()
    const readable = native(mime, destination.input)
    if (readable && file.size <= MAX_INLINE_BYTES) return addInline(file, mime, clipboard)
    // Buff (#459): why the file goes as a path is said on its chip.
    const note = BuffComposerParts.attachmentNote({ route: "file", mime, size: file.size, reason: readable ? "size" : "type" })
    const sourcePath = input.getPathForFile?.(file) || undefined
    if (destination.local && sourcePath) return addPath({ filename: file.name, mime, path: sourcePath, note }, file)
    void stage(file, mime, destination, note)
    return true
  }

  const addInline = async (file: File, mime: string, clipboard: boolean) => {
    const blob = input.store ? await input.store(file) : await createBlobReference(file)
    const sourcePath = input.getPathForFile?.(file) || undefined
    // Clipboard images arrive with a fresh name on every paste, so they match on bytes alone.
    const duplicate = draft
      .current()
      .some(
        (part) =>
          part.type === "image" &&
          part.blob.id === blob.id &&
          (sourcePath ? part.sourcePath === sourcePath : !part.sourcePath && (clipboard || part.filename === file.name)),
      )
    if (duplicate) {
      input.duplicate()
      return true
    }
    const attachment: ImageAttachmentPart = { type: "image", id: crypto.randomUUID(), filename: file.name, sourcePath, mime, blob }
    draft.set([...draft.current(), attachment], draft.cursor())
    return true
  }

  const addPath = (attachment: Pick<PathAttachmentPart, "filename" | "mime" | "path" | "note">, file?: File) => {
    if (draft.current().some((part) => part.type === "path" && part.path === attachment.path)) {
      input.duplicate()
      return true
    }
    const id = crypto.randomUUID()
    if (file) pickedFiles.set(id, file)
    draft.set([...draft.current(), { type: "path", id, ...attachment }], draft.cursor())
    return true
  }

  // Buff (#459): an uploaded file gets a new path, so a duplicate is recognised by the file itself.
  const stage = async (file: File, mime: string, destination: AttachmentDestination, note?: string) => {
    const key = `${file.name}\0${file.size}\0${file.lastModified}`
    if (staged.has(key)) {
      const path = staged.get(key)
      if (path === undefined || draft.current().some((part) => part.type === "path" && part.path === path))
        return input.duplicate()
    }
    staged.set(key, undefined)
    const id = crypto.randomUUID()
    pending.set((ids) => [...ids, id])
    const path = await uploads
      .track({ id, filename: file.name, mime, size: file.size }, (report, signal) =>
        destination.upload(file, report, signal),
      )
      .catch((error: unknown) => {
        input.onUploadError(error)
        return undefined
      })
      .finally(() => pending.set((ids) => ids.filter((item) => item !== id)))
    if (!path) return void staged.delete(key)
    staged.set(key, path)
    addPath({ filename: file.name, mime, path, note }, file)
  }

  const addAll = (files: File[]) =>
    files.reduce(async (result, file) => {
      const previous = await result
      return (await add(file)) || previous
    }, Promise.resolve(false))

  const handleDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return
    event.preventDefault()
    input.setDragging(false)
    const plain = event.dataTransfer?.getData("text/plain")
    if (plain?.startsWith("file:")) {
      const path = plain.slice("file:".length)
      input.focusEditor()
      draft.addMention({ type: "file", path, content: `@${path}`, start: 0, end: 0 })
      return
    }
    const files = event.dataTransfer?.files
    if (files) await addAll(Array.from(files))
  }

  return {
    pending,
    /** Uploads this composer started that are still in flight; sending waits for them. */
    uploads: (all: Upload[]) => all.filter((item) => pending.get().includes(item.id)),
    addAll,
    handleDrop,
    /** A paste carrying files (or, on desktop, a clipboard image with no text). */
    paste(event: ClipboardEvent) {
      const clipboard = event.clipboardData
      if (!shouldPasteAsAttachment(clipboard, !!input.readClipboardImage)) return false
      event.preventDefault()
      event.stopPropagation()
      const files = Array.from(clipboard?.items ?? []).flatMap((item) => {
        const file = item.kind === "file" ? item.getAsFile() : null
        return file ? [file] : []
      })
      if (files.length > 0) {
        void addAll(files)
        return true
      }
      void input.readClipboardImage?.().then((file) => file && add(file, true))
      return true
    },
    pick(fallback: () => void) {
      if (!input.picker) return fallback()
      void input.picker({ defaultPath: input.directory(), multiple: true }, (file) => add(file)).catch(input.onError)
    },
    /** Document-wide drag tracking while the composer is mounted; returns the cleanup. */
    mount() {
      const clear = () => input.setDragging(false)
      const over = (event: DragEvent) => {
        if (input.isDialogActive()) return
        event.preventDefault()
        const types = event.dataTransfer?.types ?? []
        if (types.includes("Files") || types.includes("text/plain")) input.setDragging(true)
      }
      const leave = (event: DragEvent) => {
        if (!input.isDialogActive() && !event.relatedTarget) clear()
      }
      const key = (event: KeyboardEvent) => {
        if (event.key === "Escape") clear()
      }
      const drop = (event: DragEvent) => void handleDrop(event)
      const cancel = input.onDragCancel?.(clear)
      document.addEventListener("dragover", over)
      document.addEventListener("dragleave", leave)
      document.addEventListener("keydown", key)
      document.addEventListener("drop", drop)
      return () => {
        cancel?.()
        document.removeEventListener("dragover", over)
        document.removeEventListener("dragleave", leave)
        document.removeEventListener("keydown", key)
        document.removeEventListener("drop", drop)
      }
    },
  }
}

export type Attachments = ReturnType<typeof createAttachments>

export function shouldPasteAsAttachment(clipboard: DataTransfer | null, readClipboardImage: boolean) {
  if (Array.from(clipboard?.items ?? []).some((item) => item.kind === "file")) return true
  if (Array.from(clipboard?.types ?? []).some((type) => type.startsWith("text/"))) return false
  return readClipboardImage
}

const imageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

// The server rejects inline attachments above this size, so larger media takes the path route.
const MAX_INLINE_BYTES = 20 * 1024 * 1024

function native(mime: string, input: AttachmentDestination["input"]) {
  if (imageMimes.has(mime)) return input.image
  if (mime === "application/pdf") return input.pdf
  return false
}

const imageExtensions = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
])
const textMimes = new Set([
  "application/json",
  "application/ld+json",
  "application/toml",
  "application/x-toml",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
])

// Text-like files normalize to text/plain so the chip labels them as text; others keep a binary type.
export async function attachmentMime(file: File) {
  const type = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  if (imageMimes.has(type) || type === "application/pdf") return type
  const index = file.name.lastIndexOf(".")
  const suffix = index === -1 ? "" : file.name.slice(index + 1).toLowerCase()
  const fallback = imageExtensions.get(suffix) ?? (suffix === "pdf" ? "application/pdf" : undefined)
  if ((!type || type === "application/octet-stream") && fallback) return fallback
  if (type.startsWith("text/") || textMimes.has(type) || type.endsWith("+json") || type.endsWith("+xml"))
    return "text/plain"
  const binary = type || "application/octet-stream"
  const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  if (bytes.some((byte) => byte === 0)) return binary
  const control = bytes.filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length
  if (bytes.length > 0 && control / bytes.length > 0.3) return binary
  return "text/plain"
}
