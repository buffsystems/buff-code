export * as BuffExport from "./buff-export.js"

import type { BuffI18n } from "./buff-i18n.js"
import { BuffSendFile } from "./buff-send-file.js"

/**
 * Выгрузка чата файлом (#969): то, что человек читал в ленте, — его слова, ответы и имена файлов.
 * Markdown — для чтения, JSON — для программ. Размышления, вызовы инструментов, стоимость и модель
 * в выгрузку не идут: человек знает модель по уровню, а не по имени. Pure.
 */

export const FORMATS = ["md", "json"] as const
export type Format = (typeof FORMATS)[number]
export const MIME: Record<Format, string> = { md: "text/markdown", json: "application/json" }

interface Part {
  readonly type?: unknown
  readonly text?: unknown
  readonly state?: { readonly metadata?: unknown }
}

interface Message {
  readonly type?: unknown
  readonly text?: unknown
  readonly files?: readonly { readonly name?: unknown; readonly mention?: unknown }[]
  readonly content?: readonly Part[]
  readonly time?: { readonly created?: unknown }
}

export interface Transfer {
  readonly info?: { readonly title?: unknown; readonly time?: { readonly created?: unknown } }
  readonly messages?: readonly Message[]
}

export interface Said {
  role: "user" | "assistant"
  time: number
  text: string
  files?: string[]
}

/** Имя файла выгрузки: название чата без знаков, которых не терпит файловая система. */
export function fileName(title: string, format: Format): string {
  const safe = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return `${safe || "chat"}.${format}`
}

const names = (list: readonly string[]) => (list.length ? { files: [...list] } : {})

/** Реплики чата по порядку: что сказано словами и какие файлы приложены или отданы. */
export function said(transfer: Transfer): Said[] {
  return (transfer.messages ?? []).flatMap((message): Said[] => {
    const time = typeof message.time?.created === "number" ? message.time.created : 0
    if (message.type === "user") {
      const files = (message.files ?? []).flatMap((file) =>
        !file.mention && typeof file.name === "string" && file.name ? [file.name] : [],
      )
      const text = typeof message.text === "string" ? message.text : ""
      return text || files.length ? [{ role: "user", time, text, ...names(files) }] : []
    }
    if (message.type !== "assistant") return []
    const parts = message.content ?? []
    const text = parts.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    const files = parts.flatMap((part) => {
      const sent = part.type === "tool" ? BuffSendFile.sentOf(part.state?.metadata) : undefined
      return sent ? [sent.name] : []
    })
    return text.length || files.length ? [{ role: "assistant", time, text: text.join("\n\n"), ...names(files) }] : []
  })
}

const titleOf = (transfer: Transfer) => (typeof transfer.info?.title === "string" ? transfer.info.title.trim() : "")

/** Чат для чтения: заголовок, затем кто что сказал — в порядке ленты. */
export function markdown(transfer: Transfer, t: BuffI18n.T): string {
  const lines = [`# ${titleOf(transfer) || t("Chat")}`, ""]
  for (const message of transfer.messages ?? []) {
    const [one] = said({ messages: [message] })
    if (!one) continue
    lines.push(`## ${one.role === "user" ? t("You") : "Buff Code"}`, "")
    if (one.role === "user") {
      if (one.text) lines.push(one.text, "")
      for (const name of one.files ?? []) lines.push(t("File: {name}", { name }), "")
      continue
    }
    // Ответ — в порядке ленты: текст и отданные файлы там, где они шли.
    for (const part of message.content ?? []) {
      if (part.type === "text" && typeof part.text === "string") lines.push(part.text, "")
      const sent = part.type === "tool" ? BuffSendFile.sentOf(part.state?.metadata) : undefined
      if (sent) lines.push(t("File: {name}", { name: sent.name }), "")
    }
  }
  return lines.join("\n")
}

/** Чат данными: название, когда начат и реплики. */
export function json(transfer: Transfer): { title: string; created: number; messages: Said[] } {
  const created = transfer.info?.time?.created
  return { title: titleOf(transfer), created: typeof created === "number" ? created : 0, messages: said(transfer) }
}
