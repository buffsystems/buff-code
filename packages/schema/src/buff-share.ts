export * as BuffShare from "./buff-share.js"

import { Schema } from "effect"
import { define } from "./rpc.js"

/**
 * Публичные ссылки на диалоги Buff Code (#816, эпик #769): окно, консоль и телефон создают и правят
 * ссылки через службу машины (`core/src/buff/share-service.ts`); содержимое отдаёт сама машина, когда
 * страницу открывают на buff.systems. Здесь — форма ссылки и RPC.
 */

export const Link = Schema.Struct({
  id: Schema.String,
  /** Адрес страницы: https://<шлюз>/share/<id>. */
  link: Schema.String,
  session: Schema.String,
  /** Весь диалог или выбранные сообщения. */
  kind: Schema.Literals(["session", "messages"]),
  /** Сколько сообщений выбрано (0 — весь диалог). */
  messages: Schema.Number,
  title: Schema.String,
  hasPass: Schema.Boolean,
  /** Эпоха, мс; null — бессрочно. */
  expiresAt: Schema.NullOr(Schema.Number),
  /** Показывать ли вызовы инструментов ИИ и их результаты. */
  tools: Schema.Boolean,
  /** Трансляция: страница следует за сессией. */
  live: Schema.Boolean,
  enabled: Schema.Boolean,
  created: Schema.Number,
  /** Шлюз знает о ссылке; false — объявление ещё не дошло, страница пока её не найдёт. */
  published: Schema.Boolean,
  /** Название сессии-источника сейчас; null — её уже нет. */
  sessionTitle: Schema.NullOr(Schema.String),
})
export type Link = typeof Link.Type

export const Status = Schema.Struct({
  gateway: Schema.String,
  connected: Schema.Boolean,
  problem: Schema.NullOr(Schema.String),
  /** Служба Buff Code запущена: без неё ссылки не создать и не показать. */
  running: Schema.Boolean,
})
export type Status = typeof Status.Type

export const CreateInput = Schema.Struct({
  session: Schema.String,
  messages: Schema.optional(Schema.Array(Schema.String)),
  title: Schema.String,
  pass: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
  tools: Schema.optional(Schema.Boolean),
  live: Schema.optional(Schema.Boolean),
})
export type CreateInput = typeof CreateInput.Type

export const UpdateInput = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  /** Новый пароль; null — снять. */
  pass: Schema.optional(Schema.NullOr(Schema.String)),
  expiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
  tools: Schema.optional(Schema.Boolean),
  live: Schema.optional(Schema.Boolean),
  enabled: Schema.optional(Schema.Boolean),
})
export type UpdateInput = typeof UpdateInput.Type

/** Сроки действия, которые предлагают окно, консоль и телефон (мс); null — бессрочно. */
export const EXPIRY_PRESETS: ReadonlyArray<{ readonly id: string; readonly ms: number | null }> = [
  { id: "none", ms: null },
  { id: "1h", ms: 60 * 60 * 1000 },
  { id: "1d", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
]

/** A message as the share dialogs list it for picking (window, console, phone): who said it, its first words. */
export interface MessagePreview {
  readonly id: string
  readonly role: "user" | "assistant"
  readonly text: string
}

/** The slice of a session message the previews read — the client's and the server's shapes both fit. */
export interface PreviewSource {
  readonly id: string
  readonly type: string
  readonly text?: string
  readonly files?: readonly unknown[]
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
}

const PREVIEW_MAX = 140

/** Only what a reader would pick: prompts and answers with text; service entries stay out. */
export function previews(messages: readonly PreviewSource[]): MessagePreview[] {
  const out: MessagePreview[] = []
  for (const m of messages) {
    if (m.type === "user") {
      const text = (m.text ?? "").trim() || (m.files?.length ? `📎 ${m.files.length}` : "")
      if (text) out.push({ id: m.id, role: "user", text: cut(text) })
    } else if (m.type === "assistant") {
      const text = (m.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join(" ")
        .trim()
      if (text) out.push({ id: m.id, role: "assistant", text: cut(text) })
    }
  }
  return out
}

/** The link's title: the session's own, or what the client calls an untitled session. */
export function defaultTitle(sessionTitle: string | undefined | null, untitled: string): string {
  const title = (sessionTitle ?? "").trim()
  return title || untitled
}

export type ExpiryPreset = (typeof EXPIRY_PRESETS)[number]["id"]

/** When a link made now with this preset ends; null — never. */
export function expiresAtFor(preset: ExpiryPreset, nowMs: number): number | null {
  const found = EXPIRY_PRESETS.find((p) => p.id === preset)
  return found?.ms == null ? null : nowMs + found.ms
}

function cut(text: string): string {
  const one = text.replace(/\s+/g, " ")
  return one.length > PREVIEW_MAX ? `${one.slice(0, PREVIEW_MAX)}…` : one
}

const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Failures = { refused: portable(Schema.Struct({})) }
const ById = portable(Schema.Struct({ id: Schema.String }))

export const Rpc = define({
  id: "buff.share",
  methods: {
    status: { input: Nothing, output: portable(Status), errors: Failures },
    list: { input: Nothing, output: portable(Schema.Array(Link)), errors: Failures },
    create: { input: portable(CreateInput), output: portable(Link), errors: Failures },
    update: { input: portable(UpdateInput), output: portable(Link), errors: Failures },
    remove: { input: ById, output: portable(Schema.Struct({})), errors: Failures },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})
