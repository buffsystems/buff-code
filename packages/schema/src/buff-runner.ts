export * as BuffRunner from "./buff-runner.js"

import { Schema } from "effect"

/**
 * Режим раннера (#439): Buff Code запускает пайплайн на воркерах. Контекст прогона — чья
 * это работа — известен ДО первой записи и приходит одной переменной окружения, JSON-ом:
 * вопросов входа и выбора организации в этом режиме нет, а каждая запись в склад уходит
 * уже привязанной к задаче. Определение общее для ядра (где режим включается) и консоли
 * (где пропускается настройка при запуске).
 */

export const ENV = "BUFF_RUNNER"

export const Context = Schema.Struct({
  org: Schema.String,
  /** null — работа в организации без проекта (например, пространство знаний). */
  project: Schema.optional(Schema.NullOr(Schema.String)),
  /** Задача (issue) и атом — числа трекера; у прогона без задачи их нет. */
  issue: Schema.optional(Schema.Number),
  atom: Schema.optional(Schema.Number),
  role: Schema.optional(Schema.String),
  phase: Schema.optional(Schema.String),
  /** Идентификатор джоба оркестратора, в котором идёт прогон. */
  job: Schema.optional(Schema.String),
  /** Кто запустил работу — логин пользователя приложения. */
  initiator: Schema.optional(Schema.String),
  /** Класс расхода, объявленный запускающим (например, research, devprep). */
  bill_class: Schema.optional(Schema.String),
  /** Куда уходят записи движка (сквозная запись) и пропуск к этой двери. Без приёмника
   *  раннер работает как раньше: база на диске, склад читает её сам. */
  sink: Schema.optional(Schema.Struct({ url: Schema.String, token: Schema.String })),
})
export type Context = typeof Context.Type

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Context))

/** Контекст раннера из окружения; null — обычный режим разработчика. Испорченное
 *  значение — ошибка: прогон не должен молча стать «разработчиком» без привязки. */
export function parse(env: Record<string, string | undefined>): Context | null {
  const raw = env[ENV]
  if (!raw) return null
  return decode(raw)
}

const HEADER: Record<Exclude<keyof Context, "sink">, string> = {
  org: "X-Buff-Org",
  project: "X-Buff-Project",
  issue: "X-Buff-Issue",
  atom: "X-Buff-Atom",
  role: "X-Buff-Role",
  phase: "X-Buff-Phase",
  job: "X-Buff-Job",
  initiator: "X-Buff-Initiator",
  bill_class: "X-Buff-Class",
}

/** Заголовки запроса к складу — по одному на известное поле; пустые не шлются. */
export function headers(ctx: Context): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(HEADER) as (keyof typeof HEADER)[]) {
    const value = ctx[key]
    if (value === undefined || value === null) continue
    out[HEADER[key]] = String(value)
  }
  return out
}
