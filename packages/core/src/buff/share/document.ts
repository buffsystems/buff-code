// Buff (#816): сообщения сессии, как их отдаёт сервер Buff Code, → документ публичной ссылки в
// контракте протокола (`ShareDocument`). Чистые функции: выбор сообщений, фильтр инструментов,
// страница по `after`/`limit`, вложения как файлы (байты — отдельной командой, частями).
import {
  SHARE_FILE_CHUNK,
  type ShareDocument,
  type ShareFile,
  type ShareFileChunk,
  type ShareItem,
  type SharePart,
} from "@buff/mobile-protocol"
import type { ShareRecord } from "./store.js"

/** Сообщение сессии в кодировке сервера: что нужно документу. */
export interface StoredMessage {
  id: string
  type: string
  text?: string
  description?: string
  files?: { data?: string; mime?: string; name?: string }[]
  content?: StoredContent[]
  time?: { created?: number | string }
  /** Ход, упавший с ошибкой. */
  error?: { message?: string }
  /** Служебная запись: кто её написал и короткий итог (цель, сценарий). */
  metadata?: { source?: string; summary?: string }
}

export type StoredContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool"
      id: string
      name: string
      state: {
        status: string
        input?: unknown
        content?: { type: string; text?: string }[]
        error?: { message?: string }
        metadata?: Record<string, unknown>
      }
    }

/** Вызов субагента (#753): его собственная сессия — в метаданных вызова. */
const SUBAGENT_TOOL = "subagent"

/** Сколько символов входа и выхода инструмента попадает в документ. */
const TOOL_CLIP = 8_000

/** Страница документа: выбранные (или все) сообщения по порядку, инструменты — по настройке ссылки. */
export function buildDocument(
  record: ShareRecord,
  messages: StoredMessage[],
  page: { after?: string; limit: number; tail?: boolean },
  sessionTitle: string,
  /** The session is being worked on now (#823): a live page keeps asking while this holds. */
  active = false,
): ShareDocument {
  const chosen = record.messages.length ? messages.filter((m) => record.messages.includes(m.id)) : messages
  const items = chosen.map((m) => toItem(m, record.tools)).filter((i): i is ShareItem => i !== null)
  // The tail (#823): where the dialog is now — the live page lands here; `next` is then nothing.
  const start = page.tail
    ? Math.max(0, items.length - page.limit)
    : page.after
      ? items.findIndex((i) => i.id === page.after) + 1
      : 0
  const slice = items.slice(start, start + page.limit)
  const last = slice.at(-1)
  return {
    title: record.title || sessionTitle,
    kind: record.messages.length ? "messages" : "session",
    tools: record.tools,
    live: record.live,
    ...(record.live ? { active } : {}),
    createdAt: record.created,
    expiresAt: record.expiresAt,
    items: slice,
    next: last && start + slice.length < items.length ? last.id : null,
  }
}

const NOTICE_SOURCES = new Set(["buff-goal", "buff-workflow"])

/** Файл, который агент передал человеку (#708): запись `sent` в метаданных вызова, когда она полная. */
function sentOf(c: Extract<StoredContent, { type: "tool" }>) {
  const sent = c.state.metadata?.sent as Record<string, unknown> | undefined
  if (!sent || typeof sent.file !== "string" || typeof sent.name !== "string") return null
  if (typeof sent.mime !== "string" || typeof sent.bytes !== "number") return null
  return {
    path: sent.file,
    name: sent.name,
    mime: sent.mime,
    size: sent.bytes,
    ...(typeof sent.note === "string" && sent.note ? { note: sent.note } : {}),
  }
}

/** Переданный файл в ссылке: `<id сообщения>:s<номер части>` — рядом с вложениями `<id>:<номер>`. */
const sentId = (message: string, index: number): string => `${message}:s${index}`

/**
 * Переданный агентом файл по его id (#892): путь внутри каталога сессии и что о нём известно;
 * null — нет такого (или сообщение не выбрано ссылкой). Байты читает владелец ссылки с диска.
 */
export function sentFile(
  record: ShareRecord,
  messages: StoredMessage[],
  file: string,
): { path: string; name: string; mime: string; size: number } | null {
  const m = /^(.+):s(\d+)$/.exec(file)
  if (!m) return null
  const [, message, index] = m
  if (record.messages.length && !record.messages.includes(message!)) return null
  const part = messages.find((x) => x.id === message)?.content?.[Number(index)]
  const sent = part?.type === "tool" ? sentOf(part) : null
  return sent ? { path: sent.path, name: sent.name, mime: sent.mime, size: sent.size } : null
}

/** Файл ссылки — вложение сообщения: `<id сообщения>:<номер>`. */
export const fileId = (message: string, index: number): string => `${message}:${index}`

/** Часть файла по его id — из вложений выбранных сообщений; null — нет такого файла. */
export function fileChunk(
  record: ShareRecord,
  messages: StoredMessage[],
  file: string,
  from: number,
): ShareFileChunk | null {
  const sep = file.lastIndexOf(":")
  if (sep <= 0) return null
  const [message, index] = [file.slice(0, sep), Number(file.slice(sep + 1))]
  if (record.messages.length && !record.messages.includes(message)) return null
  const m = messages.find((x) => x.id === message)
  const f = m?.files?.[index]
  if (!m || !f || typeof f.data !== "string") return null
  const bytes = Buffer.from(f.data, "base64")
  const part = bytes.subarray(from, from + SHARE_FILE_CHUNK)
  return {
    file: fileOf(message, index, f, bytes.length),
    data: part.toString("base64"),
    from,
    next: from + part.length < bytes.length ? from + part.length : null,
  }
}

function fileOf(
  message: string,
  index: number,
  f: { mime?: string; name?: string; data?: string },
  size?: number,
): ShareFile {
  return {
    id: fileId(message, index),
    name: f.name || `file-${index + 1}`,
    mime: f.mime || "application/octet-stream",
    size: size ?? (f.data ? Buffer.byteLength(f.data, "base64") : 0),
  }
}

function toItem(m: StoredMessage, tools: boolean): ShareItem | null {
  const at = typeof m.time?.created === "number" ? m.time.created : Date.parse(String(m.time?.created ?? "")) || 0
  if (m.type === "user") {
    const parts: SharePart[] = []
    if (m.text) parts.push({ kind: "text", text: m.text })
    ;(m.files ?? []).forEach((f, i) => parts.push({ kind: "file", file: fileOf(m.id, i, f) }))
    return parts.length ? { id: m.id, role: "user", at, parts } : null
  }
  if (m.type === "assistant") {
    const parts: SharePart[] = []
    ;(m.content ?? []).forEach((c, index) => {
      if (c.type === "text" && c.text) parts.push({ kind: "text", text: c.text })
      else if (c.type === "reasoning" && tools && c.text) parts.push({ kind: "reasoning", text: c.text })
      else if (c.type === "tool") {
        // A file handed to the person (#892) is content of the dialog, not a step: it shows with or
        // without tools, as the window and the phone show it — a card, not the call behind it.
        const sent = sentOf(c)
        if (sent)
          parts.push({
            kind: "file",
            file: { id: sentId(m.id, index), name: sent.name, mime: sent.mime, size: sent.size },
            ...(sent.note ? { note: sent.note } : {}),
          })
        else if (tools) parts.push(toolPart(c))
      }
    })
    // A failed turn (#892) says so, as in the window.
    if (m.error?.message) parts.push({ kind: "notice", label: m.error.message, tone: "error" })
    return parts.length ? { id: m.id, role: "assistant", at, parts } : null
  }
  // The goal and workflows write notices for the person (#892); other synthetic records are not shown.
  if (m.type === "synthetic" && m.description && NOTICE_SOURCES.has(m.metadata?.source ?? "")) {
    const notice: SharePart = {
      kind: "notice",
      label: m.description,
      ...(m.metadata?.summary ? { summary: m.metadata.summary } : {}),
    }
    return { id: m.id, role: "system", at, parts: [notice] }
  }
  // Служебные записи (сжатие, смена модели, системные вставки) читателю не нужны — кроме
  // описания, которое окно само показывает человеку.
  if ((m.type === "system" || m.type === "compaction") && m.description) {
    return { id: m.id, role: "system", at, parts: [{ kind: "text", text: m.description }] }
  }
  return null
}

function toolPart(c: Extract<StoredContent, { type: "tool" }>): SharePart {
  const status = c.state.status === "completed" ? "done" : c.state.status === "error" ? "error" : "running"
  // A subagent's call names its own session (#893): the page opens it with `sub`.
  const child = c.state.metadata?.sessionID
  const input =
    c.state.input === undefined
      ? undefined
      : clip(typeof c.state.input === "string" ? c.state.input : JSON.stringify(c.state.input, null, 2))
  const output =
    status === "error"
      ? c.state.error?.message
      : (c.state.content ?? [])
          .map((x) => x.text ?? "")
          .filter(Boolean)
          .join("\n") || undefined
  return {
    kind: "tool",
    name: c.name,
    title: c.name,
    status,
    ...(input ? { input } : {}),
    ...(output ? { output: clip(output) } : {}),
    ...(c.name === SUBAGENT_TOOL && typeof child === "string" && child ? { session: child } : {}),
  }
}

const clip = (text: string): string => (text.length > TOOL_CLIP ? `${text.slice(0, TOOL_CLIP)}…` : text)
