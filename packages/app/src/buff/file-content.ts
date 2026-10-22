import type { FileContent } from "@/runtime/server/types"

/**
 * Просмотр файлов (#451). Служба отдаёт файл байтами, а окно читало их всегда как текст: вместо
 * картинки — «изображение недоступно», вместо PDF — мусор. Здесь байты становятся тем, что
 * просмотр умеет показать: текст, картинка или звук (base64 с типом), SVG (текст с типом), PDF и
 * видео (читаются заново при показе — не держим их в памяти), прочее двоичное — честно двоичным.
 */

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
}

const extension = (path: string | undefined) => {
  const name = path?.split("/").pop() ?? ""
  const at = name.lastIndexOf(".")
  return at === -1 ? "" : name.slice(at + 1).toLowerCase()
}

export type PreviewKind = "markdown" | "mermaid" | "pdf" | "video"

const PREVIEW: Record<string, PreviewKind> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  mmd: "mermaid",
  mermaid: "mermaid",
  pdf: "pdf",
  mp4: "video",
  m4v: "video",
  webm: "video",
  mov: "video",
  ogv: "video",
}

/** Файлы, у которых есть свой просмотр вместо исходника. */
export function previewKind(path: string | undefined): PreviewKind | undefined {
  return PREVIEW[extension(path)]
}

export type MediaKind = "image" | "video" | "audio" | "pdf" | "text"

const TEXT_MIME = /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|yaml|toml|x-sh|sql))/

/** Как показать вложение по его типу (#459); неизвестный — никак, его открывают в приложении. */
export function mediaKind(mime: string): MediaKind | undefined {
  if (mime === "image/svg+xml" || mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime === "application/pdf") return "pdf"
  if (TEXT_MIME.test(mime)) return "text"
  return undefined
}

export function mimeOf(path: string | undefined): string | undefined {
  return MIME[extension(path)]
}

function base64(bytes: Uint8Array): string {
  let raw = ""
  const step = 0x8000
  for (let at = 0; at < bytes.length; at += step) raw += String.fromCharCode(...bytes.subarray(at, at + step))
  return btoa(raw)
}

/** Текст ли это: без нулевых байтов в начале и читается как UTF-8. */
function asText(bytes: Uint8Array): string | undefined {
  if (bytes.subarray(0, 8000).includes(0)) return undefined
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

export function fileContent(path: string, bytes: Uint8Array): FileContent {
  const mime = mimeOf(path)
  if (mime === "image/svg+xml") return { type: "text", content: new TextDecoder().decode(bytes), mimeType: mime }
  if (mime?.startsWith("image/") || mime?.startsWith("audio/"))
    return { type: "binary", encoding: "base64", mimeType: mime, content: base64(bytes) }
  if (mime) return { type: "binary", content: "", mimeType: mime }
  const text = asText(bytes)
  return text === undefined
    ? { type: "binary", content: "", mimeType: "application/octet-stream" }
    : { type: "text", content: text }
}
