export * as BuffSearch from "./buff-search.js"

import { BuffPlainText } from "./buff-plain-text.js"
import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"
import { define } from "./rpc.js"

/**
 * Поиск по тексту переписки (#453): раньше сессию можно было найти только по названию. Ищем в
 * сообщениях человека и в текстах ответов; в выдаче — сессия, фрагмент с совпадением и сколько
 * совпадений ещё. Здесь правила, общие для ядра, окна и консоли; ищет ядро
 * (`core/src/buff/search.ts`).
 */

export const Fragment = Schema.Struct({ before: Schema.String, match: Schema.String, after: Schema.String })
export type Fragment = typeof Fragment.Type

export const Result = Schema.Struct({
  sessionID: Schema.String,
  title: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  messageID: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  time: Schema.Number,
  fragment: Fragment,
  /** Сколько ещё сообщений этой сессии содержат искомое. */
  more: Schema.Number,
})
export type Result = typeof Result.Type

const portable = Schema.toStandardSchemaV1

export const Rpc = define({
  id: "buff.search",
  methods: {
    sessions: {
      input: portable(Schema.Struct({ query: Schema.String })),
      output: portable(Schema.Array(Result)),
      errors: { invalid: portable(Schema.Struct({})) },
    },
  },
  events: {},
})

// --- запрос ---------------------------------------------------------------------------------

export function problem(query: string): string | undefined {
  return query.trim().length < 2 ? "Type at least two characters." : undefined
}

/**
 * Запрос в тех написаниях, в каких его стоит искать в базе: она сравнивает буквы точно (регистр
 * не различает только у латиницы). Точное сравнение без учёта регистра делается потом, по тексту.
 */
export function variants(query: string): string[] {
  const typed = query.trim()
  const lower = typed.toLowerCase()
  return [...new Set([typed, lower, lower.charAt(0).toUpperCase() + lower.slice(1), typed.toUpperCase()])]
}

// --- текст сообщения ------------------------------------------------------------------------

interface Message {
  readonly type: string
  readonly text?: unknown
  readonly content?: readonly { readonly [key: string]: unknown }[]
}

/** Что в сообщении написано словами: текст человека или текстовые части ответа. */
export function texts(message: Message): string[] {
  if (message.type === "user") return typeof message.text === "string" ? [message.text] : []
  if (message.type !== "assistant") return []
  return (message.content ?? []).flatMap((part) =>
    part.type === "text" && typeof part.text === "string" ? [part.text] : [],
  )
}

// --- фрагмент -------------------------------------------------------------------------------

/** Совпадение с текстом вокруг: `radius` знаков с каждой стороны, обрезанных по границе слова. */
export function fragment(text: string, query: string, radius: number): Fragment | undefined {
  const needle = query.trim().toLowerCase()
  if (!needle) return undefined
  const flat = BuffPlainText.of(text).replace(/\s+/g, " ").trim()
  const at = flat.toLowerCase().indexOf(needle)
  if (at === -1) return undefined
  const end = at + needle.length
  const from = Math.max(0, at - radius)
  const to = Math.min(flat.length, end + radius)
  // Обрезанный край сдвигается к границе слова, чтобы не показывать обрубок.
  const left = from === 0 ? 0 : Math.min(at, flat.indexOf(" ", from) + 1 || at)
  const right = to === flat.length ? flat.length : Math.max(end, flat.lastIndexOf(" ", to))
  return {
    before: (left > 0 ? "…" : "") + flat.slice(left, at),
    match: flat.slice(at, end),
    after: flat.slice(end, right) + (right < flat.length ? "…" : ""),
  }
}

// --- выдача ---------------------------------------------------------------------------------

export interface Hit {
  readonly sessionID: string
  readonly title?: string
  readonly directory?: string
  readonly messageID: string
  readonly role: "user" | "assistant"
  readonly time: number
  readonly text: string
}

/** По одной строке на сессию: самое свежее совпадение и сколько их ещё; свежие сессии первыми. */
export function results(hits: readonly Hit[], query: string, radius = 60): Result[] {
  const bySession = new Map<string, { hit: Hit; fragment: Fragment; count: number }>()
  for (const hit of hits.toSorted((a, b) => b.time - a.time)) {
    const found = fragment(hit.text, query, radius)
    if (!found) continue
    const known = bySession.get(hit.sessionID)
    if (known) known.count++
    else bySession.set(hit.sessionID, { hit, fragment: found, count: 1 })
  }
  return [...bySession.values()].map(({ hit, fragment: found, count }) => ({
    sessionID: hit.sessionID,
    ...(hit.title ? { title: hit.title } : {}),
    ...(hit.directory ? { directory: hit.directory } : {}),
    messageID: hit.messageID,
    role: hit.role,
    time: hit.time,
    fragment: found,
    more: count - 1,
  }))
}

/** «ещё N совпадений» — через множественное число экрана (#472). */
export function moreLabel(more: number, n: BuffI18n.N = BuffI18n.englishPlural): string | undefined {
  return more > 0 ? n(more, "{n} more match|{n} more matches") : undefined
}

/** Кто сказал фрагмент — английская исходная строка, переводит экран (#472). */
export const ROLE: Record<Result["role"], string> = { user: "you", assistant: "answer" }
