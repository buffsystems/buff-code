export * as BuffSendFile from "./buff-send-file.js"

import { BuffI18n } from "./buff-i18n.js"

/**
 * Файл от агента человеку (#708): инструмент `send_file` отдаёт в ленту сессии файл из её папки —
 * документ, таблицу, картинку. Модели содержимое не уходит; окно, консоль и телефон рисуют
 * карточку по записи вызова (`metadata.sent`) и открывают файл сами.
 */

export const TOOL = "send_file"

/** Как и файл, который человек прикладывает сам. */
export const MAX_BYTES = 20 * 1024 * 1024

/** Что отдано: путь от папки сессии, имя, тип, размер и подпись агента. */
export interface Sent {
  file: string
  name: string
  mime: string
  bytes: number
  note?: string | undefined
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
}

export function mimeOf(name: string): string {
  const ext = /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""
  return MIME[ext] ?? "application/octet-stream"
}

/** Картинка и текст показываются на месте; документ открывает система. */
export function kindOf(mime: string): "image" | "text" | "document" {
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "image"
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || mime === "application/yaml")
    return "text"
  return "document"
}

/** Размер для карточки: «12 КБ», «1.5 МБ». */
export function sizeOf(bytes: number, t: BuffI18n.T = BuffI18n.english): string {
  if (bytes < 1024 * 1024) return t("{n} KB", { n: Math.max(1, Math.round(bytes / 1024)) })
  return t("{n} MB", { n: (bytes / 1024 / 1024).toFixed(1) })
}

export function sentOf(metadata: unknown): Sent | undefined {
  const sent = (metadata as { sent?: Partial<Sent> } | undefined)?.sent
  if (!sent || typeof sent.file !== "string" || typeof sent.name !== "string") return undefined
  if (typeof sent.mime !== "string" || typeof sent.bytes !== "number") return undefined
  return { file: sent.file, name: sent.name, mime: sent.mime, bytes: sent.bytes, note: sent.note }
}
