export * as BuffRequestHeaders from "./request-headers.js"

import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffRunner } from "@opencode/schema/buff-runner"
import { BuffRunnerMode } from "./runner.js"

const BUFF = "buff"

/** Апстримные заголовки сессии → наши имена; хеш проекта апстрима не переносится. */
const RENAMED: Record<string, string> = {
  "x-opencode-session": "X-Buff-Session",
  "x-parent-session-id": "X-Buff-Parent-Session",
  "x-opencode-client": "X-Buff-Client",
}

/**
 * Заголовки запроса к модели под нашими именами (#510). По X-Buff-Session шлюз к моделям (#501)
 * привязывает расход к сессии, по контексту раннера — к задаче, фазе и роли. Апстримные
 * x-opencode-* наружу не уходят, агент запроса — buff/…; нейтральные (x-session-affinity,
 * X-Session-Id) остаются — на них держится привязка к провайдеру. Своему провайдеру разработчика
 * (#562) наши имена не уходят: сессия и клиент Buff ему ни к чему.
 */
export function rebrand(
  headers: Record<string, string>,
  runner: BuffRunner.Context | null,
  buff: boolean,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (buff && RENAMED[lower]) out[RENAMED[lower]] = value
    if (lower === "user-agent") out[name] = value.replace(/^opencode\//, "buff/")
    else if (!lower.startsWith("x-opencode-")) out[name] = value
  }
  return runner && buff ? { ...BuffRunner.headers(runner), ...out } : out
}

/** Идёт ли запрос в Buff: у разработчика — только модель провайдера buff; у раннера все модели
 *  его — и подключённые конфигом к шлюзу тоже. */
export function toBuff(providerID: string, runner: boolean): boolean {
  return runner || providerID === BUFF
}

export const Plugin = define({
  id: "buff.request-headers",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.session.hook("model.request", (evt) =>
      Effect.sync(() => {
        const runner = BuffRunnerMode.context()
        const next = rebrand(evt.headers, runner, toBuff(evt.model.providerID, BuffRunnerMode.active()))
        for (const key of Object.keys(evt.headers)) delete evt.headers[key]
        Object.assign(evt.headers, next)
      }),
    )
  }),
})
