export * as BuffQueryMap from "./buff-query-map.js"

import { BuffPlainText } from "./buff-plain-text.js"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Карта запросов (#465), как в ZCode: запросы человека в сессии по порядку — текст, начало
 * ответа (всё, что модель написала до следующего запроса) и идёт ли ответ сейчас. Окно рисует
 * риски слева от ленты, консоль — список «Перейти к запросу».
 */

export type Query = {
  readonly id: string
  readonly index: number
  readonly text: string
  readonly answer: string
  readonly running: boolean
}

type Part = { readonly type?: unknown; readonly text?: unknown }
type Message = {
  readonly id: string
  readonly type?: unknown
  readonly text?: unknown
  readonly content?: unknown
  readonly time?: { readonly created?: number; readonly completed?: number }
}

const textOf = (message: Message) =>
  (Array.isArray(message.content) ? (message.content as Part[]) : [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("")

// One pass over the transcript: a streaming session calls this on every delta, so it must not
// copy the list per message.
export function queries(messages: readonly Message[]): Query[] {
  const list: Query[] = []
  for (const message of messages) {
    if (message.type === "user") {
      list.push({
        id: message.id,
        index: list.length + 1,
        text: typeof message.text === "string" ? message.text : "",
        answer: "",
        running: false,
      })
      continue
    }
    const last = list.at(-1)
    if (message.type !== "assistant" || !last) continue
    list[list.length - 1] = {
      ...last,
      // Ответ из нескольких сообщений модели — с переносом между ними, а не слитно.
      answer: [last.answer, textOf(message)].filter((part) => part.trim()).join("\n"),
      running: message.time?.completed === undefined,
    }
  }
  return list
}

export function shown(messages: readonly Message[]): boolean {
  return messages.filter((message) => message.type === "user").length >= 2
}

export function preview(query: Query, t: BuffI18n.T = BuffI18n.english) {
  return {
    title: t("Request {index}", { index: query.index }),
    query: query.text.trim() || t("Request without text"),
    answer: BuffPlainText.of(query.answer) || (query.running ? t("The answer is still coming") : t("No answer yet")),
  }
}
