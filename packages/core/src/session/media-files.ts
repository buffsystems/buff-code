export * as SessionMediaFiles from "./media-files.js"

import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { LLMRequest } from "@opencode/ai"
import { BuffAttachment } from "@opencode/schema/buff-attachment"
import type { Model } from "@opencode/schema/model"
import type { SessionError } from "@opencode/schema/session-error"
import type { Content } from "@opencode/schema/tool"

/**
 * Файлы, которые уходят модели текстом, а не содержимым (#757): модель их не читает или человек
 * решил их не отправлять. Такой файл лежит на диске, а модели называется путь к нему, чтобы
 * она могла разобрать его инструментами — и картинку из буфера, и фото с телефона.
 */
export interface Media {
  readonly key: string
  readonly data: string | Uint8Array
  readonly mime: string
  readonly name?: string
}

type Messages = LLMRequest["messages"]

/** Ключ файла в запросе: по нему текст замены находит путь к сохранённому файлу. */
export const mediaKey = (data: string | Uint8Array): string =>
  typeof data === "string" ? data : Buffer.from(data).toString("base64")

/** Форматы, которые человек исключил, и как (`BuffAttachment.omittedMedia`). */
export type Omitted = ReadonlyMap<string, BuffAttachment.OmitMode>

/** Модель не получит этот файл содержимым: не читает формат, человек его исключил или формат не для моделей. */
export const isReplaced = (mime: string, capabilities: Model.Capabilities, omitted: Omitted): boolean => {
  const modality = BuffAttachment.modalityOf(mime)
  // A format no model reads as content (#971): it always reaches the model as a saved file.
  if (!modality) return true
  return omitted.has(modality) || !capabilities.input.some((item) => item.startsWith(modality))
}

const eachMedia = (messages: Messages): Array<{ data: string | Uint8Array; mime: string; name?: string }> =>
  messages.flatMap((message) =>
    message.content.flatMap((part) => {
      if (part.type === "media") return [{ data: part.data, mime: part.mediaType, name: part.filename }]
      if (part.type !== "tool-result" || part.result.type !== "content") return []
      return (part.result.value as Content[]).flatMap((item) =>
        item.type === "file" ? [{ data: item.uri, mime: item.mime, name: item.name }] : [],
      )
    }),
  )

/** Файлы запроса, которые модель получит текстом с путём (без тех, что человек велел не читать). */
export const replaced = (messages: Messages, capabilities: Model.Capabilities, omitted: Omitted): Media[] =>
  eachMedia(messages)
    .filter((media) => isReplaced(media.mime, capabilities, omitted))
    .filter((media) => omitted.get(BuffAttachment.modalityOf(media.mime) ?? "") !== "ignore")
    .map((media) => ({ key: mediaKey(media.data), ...media }))

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
}

/** Сколько байт имени файла остаётся после приставки по содержимому: с ней — далеко до 255 (NAME_MAX). */
const NAME_BYTES = 120

/** Имя не длиннее `max` байт; расширение (до 16 знаков) остаётся, укорачивается основа. */
const capBytes = (name: string, max: number) => {
  if (Buffer.byteLength(name) <= max) return name
  const dot = name.lastIndexOf(".")
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : ""
  const stem = Array.from(name.slice(0, name.length - ext.length))
  while (stem.length > 0 && Buffer.byteLength(stem.join("") + ext) > max) stem.pop()
  return stem.join("") + ext
}

const fileName = (media: Media, hash: string) => {
  const ext = EXTENSIONS[media.mime.toLowerCase()] ?? media.mime.split("/")[1]?.replace(/[^\w]+/g, "") ?? "bin"
  // Буквы любого языка остаются (#971): «Подготовка к встрече.pptx» не становится «_.pptx»; имя из
  // macOS (NFD) сначала собирается (R14-06), иначе «й» распадалось бы на «и_».
  const base = path
    .basename(media.name ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}_.\-]+/gu, "_")
    .replace(/^\.+/, "")
  return `${hash.slice(0, 12)}-${capBytes(base || `file.${ext}`, NAME_BYTES)}`
}

/** Имя файла в тексте для модели (R14-06): собранное (NFC), в кавычках, с экранированными кавычками и
 *  переводами строк — имя, данное человеком, модель читает как имя, а не как указания. */
export const quotedName = (name: string): string => JSON.stringify(name.normalize("NFC"))

const bytes = (data: string | Uint8Array): Uint8Array =>
  typeof data !== "string"
    ? data
    : Buffer.from(data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data, "base64")

const localPath = (data: string | Uint8Array): string | undefined => {
  if (typeof data !== "string" || !data.startsWith("file:")) return undefined
  try {
    return fileURLToPath(data)
  } catch {
    return undefined
  }
}

/**
 * Кладёт файлы в `dir` под именем по содержимому — каждый один раз; у файла с диска берёт его
 * путь. Возвращает путь по ключу файла.
 */
export async function save(media: ReadonlyArray<Media>, dir: string): Promise<Map<string, string>> {
  const saved = new Map<string, string>()
  for (const item of media) {
    if (saved.has(item.key)) continue
    const local = localPath(item.data)
    if (local) {
      saved.set(item.key, local)
      continue
    }
    const content = bytes(item.data)
    const target = path.join(dir, fileName(item, crypto.createHash("sha256").update(content).digest("hex")))
    const exists = await fs.stat(target).then(
      () => true,
      () => false,
    )
    if (!exists) {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(target, content)
    }
    saved.set(item.key, target)
  }
  return saved
}

/** Отказы, которые могли случиться из-за файла; лимит, ключ, деньги и связь — нет. */
const FILE_FAILURES = new Set([
  "provider.invalid-request",
  "provider.unsupported-operation",
  "provider.internal",
  "provider.invalid-output",
  "unknown",
])

/** Отказ модели на запросе с файлами называет эти файлы — по ним клиенты предлагают, как быть. */
export function withAttachments(error: SessionError.Error, messages: Messages): SessionError.Error {
  if (!FILE_FAILURES.has(error.type)) return error
  const seen = new Set<string>()
  const attachments = eachMedia(messages).flatMap((media) => {
    if (!BuffAttachment.modalityOf(media.mime)) return []
    // Файл, приложенный по пути, называется по имени: путь принадлежит машине, человеку нужно имя.
    const name = media.name?.split(/[\\/]/).pop() || undefined
    const id = `${media.mime}\u0000${name ?? ""}`
    if (seen.has(id)) return []
    seen.add(id)
    return [{ ...(name === undefined ? {} : { name }), mime: media.mime }]
  })
  return attachments.length === 0 ? error : { ...error, attachments }
}
