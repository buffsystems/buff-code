export * as BuffArtifacts from "./buff-artifacts.js"

import { Schema } from "effect"
import { BuffSendFile } from "./buff-send-file.js"
import { define } from "./rpc.js"

/**
 * Результаты (#969): файлы, которые агент отдал человеку, — записи `sent` в ленте чата: от
 * `send_file` (в метаданных вызова) и от вложенных вызовов Code Mode (рисование через MCP — в
 * строке вызова). Второго хранилища нет: список выводится из переписки и не может с ней разойтись.
 * Здесь правила, общие для ядра и клиентов; ищет ядро (`core/src/buff/artifacts.ts`).
 */

export const Item = Schema.Struct({
  /** `<сообщение>:<вызов>[:n]` — n у файла из вложенного вызова, его место в списке вызовов. */
  id: Schema.String,
  sessionID: Schema.String,
  title: Schema.optional(Schema.String),
  /** Папка чата: от неё считается относительный путь файла. */
  directory: Schema.optional(Schema.String),
  /** Путь как в записи: от папки чата или абсолютный. */
  file: Schema.String,
  name: Schema.String,
  mime: Schema.String,
  bytes: Schema.Number,
  note: Schema.optional(Schema.String),
  time: Schema.Number,
})
export type Item = typeof Item.Type

const portable = Schema.toStandardSchemaV1

export const Rpc = define({
  id: "buff.artifacts",
  methods: {
    list: {
      input: portable(
        Schema.Struct({
          /** Только этот чат. */
          sessionID: Schema.optional(Schema.String),
          /** Только чаты в этих папках (и глубже). */
          directories: Schema.optional(Schema.Array(Schema.String)),
          /** Кроме чатов в этих папках (и глубже). */
          except: Schema.optional(Schema.Array(Schema.String)),
          limit: Schema.Number,
          offset: Schema.optional(Schema.Number),
        }),
      ),
      output: portable(Schema.Struct({ items: Schema.Array(Item), next: Schema.optional(Schema.Number) })),
    },
  },
  events: {},
})

/** Метка, по которой база отбирает сообщения-кандидаты: без неё записи в сообщении нет. */
export const MARK = '"sent"'

interface Part {
  readonly type?: unknown
  readonly id?: unknown
  readonly state?: { readonly metadata?: unknown }
}

export interface Found {
  /** id вызова в сообщении. */
  readonly part: string
  /** Место вложенного вызова; нет — запись самого вызова. */
  readonly n?: number
  readonly sent: BuffSendFile.Sent
}

/** Файлы, отданные в одном сообщении ответа, в порядке ленты. Неполная запись пропускается. */
export function found(message: { readonly content?: readonly Part[] }): Found[] {
  return (message.content ?? []).flatMap((part): Found[] => {
    if (part.type !== "tool" || typeof part.id !== "string") return []
    const metadata = part.state?.metadata
    const own = BuffSendFile.sentOf(metadata)
    const calls = (metadata as { toolCalls?: unknown } | undefined)?.toolCalls
    const nested = (Array.isArray(calls) ? calls : []).flatMap((call, n): Found[] => {
      const sent = BuffSendFile.sentOf(call)
      return sent ? [{ part: part.id as string, n, sent }] : []
    })
    return [...(own ? [{ part: part.id, sent: own }] : []), ...nested]
  })
}

export const idOf = (messageID: string, item: Found) =>
  `${messageID}:${item.part}${item.n === undefined ? "" : `:${item.n}`}`

/** Лежит ли папка `directory` в одной из `roots` (или это она сама). */
export function under(directory: string | undefined, roots: readonly string[]): boolean {
  return roots.some((root) => directory === root || (directory ?? "").startsWith(`${root}/`))
}
