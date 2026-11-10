export * as BuffSetup from "./buff-setup.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Режим «Настройка» (#765): видимый режим работы, в котором модель подключает к себе внешние
 * сервисы и источники по просьбе человека простыми словами и, с разрешения, улучшает себя.
 * Здесь — имена агента, инструмента и RPC, одинаковые для ядра, окна, консоли и телефона.
 * Режим универсален: названия сервисов здесь не живут.
 */

export const AGENT = "setup"

/** Инструмент обычных режимов: открыть новую сессию настройки с готовой задачей. */
export const TOOL = "session_open"

/** Действие в запросе разрешения: подтверждается каждый переход, «разрешить всегда» у него нет. */
export const PERMISSION_ACTION = "buff_setup_open"

/** Сессия режима настройки — по её агенту; так сайдбары отбирают «свой набор сессий». */
export function isSetup(session: { readonly agent?: string }): boolean {
  return session.agent === AGENT
}

/** Строки запроса разрешения — то, что человек подтверждает, на его языке. */
export function confirmation(input: { readonly title: string; readonly task: string }, t: BuffI18n.T): string[] {
  return [t("Open a setup session «{title}»", { title: input.title }), t("Task: {task}", { task: input.task })]
}

const portable = Schema.toStandardSchemaV1

export const Opened = Schema.Struct({
  session: Schema.String,
  /** Сессия, из которой перешли, когда переход предложила модель. */
  from: Schema.optional(Schema.String),
})
export type Opened = typeof Opened.Type

export const Rpc = define({
  id: "buff.setup",
  methods: {
    /** Открыть новую сессию настройки; с текстом — сразу задать его первым сообщением. */
    open: {
      input: portable(Schema.Struct({ text: Schema.optional(Schema.String) })),
      output: portable(Schema.Struct({ session: Schema.String })),
    },
  },
  events: {
    /** Сессия настройки открыта (из окна, консоли, телефона или моделью) — её показывают. */
    opened: { schema: portable(Opened) },
  },
})
