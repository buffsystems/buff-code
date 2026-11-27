export * as BuffChatConnections from "./buff-chat-connections.js"

import { Schema } from "effect"
import { define } from "./rpc.js"

/**
 * Подключения, выключенные в одном чате (#969, R13-07), — как переключатели инструментов в беседе
 * у Claude. Человек убирает подключение из чата, не трогая его в других: модель не видит его
 * инструментов, а вызов отклоняется. Выбор человека, а не свойство сессии: хранится у
 * пользователя, по сессиям. Помощники чата (сабагенты) — часть чата: им подключение тоже закрыто.
 * Хранит ядро (`core/src/buff/chat-connections.ts`).
 */

/** Сессия → имена выключенных в ней серверов. */
export const State = Schema.Record(Schema.String, Schema.Array(Schema.String))
export type State = typeof State.Type

export const EMPTY: State = {}

export const Get = Schema.Struct({ sessionID: Schema.String })
export const Change = Schema.Struct({ sessionID: Schema.String, server: Schema.String, on: Schema.Boolean })
export type Change = typeof Change.Type
export const Off = Schema.Struct({ off: Schema.Array(Schema.String) })

const portable = Schema.toStandardSchemaV1

export const Rpc = define({
  id: "buff.chat-connections",
  methods: {
    get: { input: portable(Get), output: portable(Off) },
    change: { input: portable(Change), output: portable(Off) },
  },
  events: {},
})

/** Включить или выключить сервер в чате; включённый везде чат из записи уходит. */
export function apply(state: State, change: Change): State {
  const current = state[change.sessionID] ?? []
  const next = change.on
    ? current.filter((name) => name !== change.server)
    : current.includes(change.server)
      ? current
      : [...current, change.server].toSorted()
  const { [change.sessionID]: _dropped, ...rest } = state
  return next.length ? { ...rest, [change.sessionID]: next } : rest
}

/** Что выключено в сессии с учётом её родителей: помощник видит выключенное в своём чате. */
export function offIn(state: State, chain: readonly string[]): ReadonlySet<string> {
  return new Set(chain.flatMap((sessionID) => state[sessionID] ?? []))
}
