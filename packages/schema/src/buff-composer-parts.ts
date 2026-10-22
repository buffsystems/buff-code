export * as BuffComposerParts from "./buff-composer-parts.js"

import { BuffI18n } from "./buff-i18n.js"

/**
 * Чипы поля ввода (#459): большой вставленный текст и цитата из ответа уходят модели целиком,
 * а в поле видны чипом с размером. Здесь — порог большой вставки (один для окна и консоли),
 * подписи и как это ложится в текст запроса; и что сказать о вложении, которое уходит не так,
 * как человек мог ожидать. Ограничений на число вложений нет — только объяснения.
 */

/** Большая вставка: от трёх строк или больше 150 символов — порог консоли. */
export function isLargePaste(text: string): boolean {
  return lines(text) >= 3 || text.length > 150
}

function lines(text: string): number {
  return (text.match(/\n/g)?.length ?? 0) + 1
}

/** Подпись чипа: «Pasted text · 3 lines» / «Вставленный текст · 3 строки». */
export const pasteLabel = (text: string, t: BuffI18n.T = BuffI18n.english, n: BuffI18n.N = BuffI18n.englishPlural) =>
  t("Pasted text · {lines}", { lines: n(lines(text), "{n} line|{n} lines") })
export const quoteLabel = (text: string, t: BuffI18n.T = BuffI18n.english, n: BuffI18n.N = BuffI18n.englishPlural) =>
  t("From the answer · {lines}", { lines: n(lines(text), "{n} line|{n} lines") })

/** Цитата — каждая строка с «> ». */
export function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
}

export interface Chip {
  readonly kind: "paste" | "quote"
  readonly text: string
}

/** Текст запроса: набранное, затем каждая вставка целиком и каждая цитата. */
export function appendTo(text: string, chips: readonly Chip[]): string {
  const blocks = chips.map((chip) => (chip.kind === "quote" ? quoteBlock(chip.text) : chip.text))
  return [text, ...blocks].filter((block) => block.length > 0).join("\n\n")
}

// --- вложения --------------------------------------------------------------------------------

export const INLINE_LIMIT_MB = 20

export interface AttachmentRoute {
  /** inline — байты едут в запросе и модель видит их сама; file — модель открывает файл инструментами. */
  readonly route: "inline" | "file"
  readonly mime: string
  readonly size: number
  /** Почему файлом: модель не читает этот тип или он слишком большой для запроса. */
  readonly reason?: "type" | "size"
}

/** Что сказать о вложении у его плашки; модель читает его сама — ничего. Строка английская — переводит экран. */
export function attachmentNote(input: AttachmentRoute): string | undefined {
  if (input.route === "inline") return undefined
  if (input.reason === "size") return `Larger than ${INLINE_LIMIT_MB} MB — goes as a file; the model opens it with its tools.`
  if (input.mime.startsWith("image/")) return "The model does not read images itself — it opens the file with its tools."
  if (input.mime === "application/pdf") return "The model does not read PDF itself — it opens the file with its tools."
  return "The model reads this file with its tools."
}
