export * as BuffAttachment from "./buff-attachment.js"

/**
 * Файлы, которые модель может не принять (#757): картинка у модели без зрения, PDF у модели,
 * которая его не читает. Формат файла — по его типу; ядро, окно, консоль и телефон называют
 * его одинаково.
 */
export type Modality = "image" | "pdf" | "audio" | "video"

const MODALITIES: ReadonlySet<string> = new Set<Modality>(["image", "pdf", "audio", "video"])

export function modalityOf(mime: string): Modality | undefined {
  const type = mime.toLowerCase()
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("audio/")) return "audio"
  if (type.startsWith("video/")) return "video"
  if (type === "application/pdf") return "pdf"
  return undefined
}

/** Форматы файлов по одному разу, в порядке появления. */
export function modalities(files: ReadonlyArray<{ readonly mime: string }>): Modality[] {
  return [...new Set(files.flatMap((file) => modalityOf(file.mime) ?? []))]
}

/**
 * Ключи метаданных сообщения человека (#757): форматы, которые он решил больше не отправлять модели
 * в этой сессии, и как: `code` — модель получает путь к файлу и разбирает его инструментами;
 * `ignore` — модель знает, что файл был, но не читает его. Позднее решение по формату отменяет раннее.
 */
export const OMIT_MEDIA = "omitMedia"
export const OMIT_AS = "omitAs"

export type OmitMode = "code" | "ignore"

export function omitMetadata(
  formats: ReadonlyArray<Modality>,
  mode: OmitMode,
): { readonly omitMedia: Modality[]; readonly omitAs: OmitMode } {
  return { [OMIT_MEDIA]: [...formats], [OMIT_AS]: mode }
}

interface MessageLike {
  readonly type: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly model?: unknown
  readonly previous?: unknown
}

const modelKey = (model: unknown): string | undefined =>
  typeof model === "object" && model !== null && "id" in model && "providerID" in model
    ? `${String(model.providerID)}/${String(model.id)}`
    : undefined

const otherModel = (message: MessageLike): boolean =>
  message.type === "model-switched" && modelKey(message.model) !== modelKey(message.previous)

/**
 * Форматы, исключённые человеком в сессии, и как: из метаданных его сообщений по порядку. Решение
 * касается модели, которая не приняла файлы: смена модели его снимает, новая модель может их прочесть.
 */
export function omittedMedia(messages: ReadonlyArray<MessageLike>): ReadonlyMap<Modality, OmitMode> {
  const omitted = new Map<Modality, OmitMode>()
  for (const message of messages) {
    if (otherModel(message)) omitted.clear()
    const listed = message.type === "user" ? message.metadata?.[OMIT_MEDIA] : undefined
    if (!Array.isArray(listed)) continue
    const mode: OmitMode = message.metadata?.[OMIT_AS] === "ignore" ? "ignore" : "code"
    for (const item of listed)
      if (typeof item === "string" && MODALITIES.has(item)) omitted.set(item as Modality, mode)
  }
  return omitted
}
