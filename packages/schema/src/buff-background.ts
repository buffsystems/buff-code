export * as BuffBackground from "./buff-background.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Фоновая работа (#456): команды и агенты, которые модель отправила в фон. Человек видит их со
 * временем работы и может остановить — в окне и в консоли. Остановленная человеком работа не
 * будит модель: отметка ложится в историю, и модель увидит её в следующем ходе. Работа,
 * завершившаяся сама, будит модель, как раньше.
 */

const portable = Schema.toStandardSchemaV1

export const Rpc = define({
  id: "buff.background",
  methods: {
    /** Остановить фоновую команду или агента по идентификатору (команды — `sh_…`, агента — его сессии). */
    stop: {
      input: portable(Schema.Struct({ id: Schema.String })),
      output: portable(Schema.Struct({ stopped: Schema.Boolean })),
    },
  },
  events: {},
})

/** Отменённую фоновую работу отменяет только человек (или её сессию останавливают нарочно). */
export function afterStop(status: string, text: string): { readonly resume?: false; readonly text: string } {
  return status === "cancelled" ? { resume: false, text: `${text}: stopped by the user.` } : { text }
}

/** Сколько идёт работа — коротко: «42 s» / «42 с», «3 min 05 s», «1 h 02 min». */
export function elapsed(ms: number, t: BuffI18n.T = BuffI18n.english): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const two = (value: number) => String(value).padStart(2, "0")
  if (seconds < 60) return t("{s} s", { s: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t("{m} min {s} s", { m: minutes, s: two(seconds % 60) })
  return t("{h} h {m} min", { h: Math.floor(minutes / 60), m: two(minutes % 60) })
}

/** Время от начала до `now`; без начала — ничего. */
export function since(started: number | undefined, now: number, t: BuffI18n.T = BuffI18n.english): string | undefined {
  return started === undefined ? undefined : elapsed(now - started, t)
}
