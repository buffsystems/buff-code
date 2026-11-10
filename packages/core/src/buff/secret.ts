export * as BuffSecret from "./secret.js"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { BuffSecret as Shape } from "@opencode/schema/buff-secret"
import type { ServerConfig } from "@opencode/schema/mcp"
import { KV } from "../kv.js"

/**
 * Хранилище секретов человека (#765): значение секретного поля формы кладётся сюда, наружу
 * уходит ссылка. Подключение получает значение в момент запуска — подстановкой `{secret:<id>}`
 * в переменных, заголовках и аргументах; в файл конфигурации значение не попадает никогда.
 */

const key = (id: string) => Shape.STORE_PREFIX + id

export interface Interface {
  /** Сохранить значение; возвращает ссылку `secret:<id>` для ответа формы. */
  readonly put: (value: string) => Effect.Effect<string>
  readonly get: (id: string) => Effect.Effect<string | undefined>
  readonly remove: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@buff/Secret") {}

export const make = (kv: Pick<KV.Interface, "get" | "set" | "remove">): Interface => ({
  put: (value) =>
    Effect.gen(function* () {
      const id = Shape.createID()
      yield* kv.set(key(id), value)
      return Shape.ref(id)
    }),
  get: (id) => kv.get(key(id)).pipe(Effect.map((value) => (typeof value === "string" ? value : undefined))),
  remove: (id) => kv.remove(key(id)),
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of(make(yield* KV.Service))
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })

export class MissingError extends Error {
  constructor(readonly id: string) {
    super(`Secret not found: ${Shape.token(id)}. Ask the user to enter it again with a form.`)
  }
}

type Lookup = (id: string) => string | undefined

const text = (value: string, lookup: Lookup) => {
  const expanded = Shape.expand(value, lookup)
  if (typeof expanded === "string") return expanded
  throw new MissingError(expanded.missing)
}
const record = (values: Record<string, string> | undefined, lookup: Lookup) =>
  values ? Object.fromEntries(Object.entries(values).map(([name, value]) => [name, text(value, lookup)])) : values

/** Настройки подключения с раскрытыми секретами — для запуска, не для хранения. */
export function substitute(config: ServerConfig, lookup: Lookup): ServerConfig | MissingError {
  try {
    if (config.type === "local")
      return {
        ...config,
        command: config.command.map((part) => text(part, lookup)),
        ...(config.environment ? { environment: record(config.environment, lookup) } : {}),
      }
    const oauth = config.oauth
      ? {
          oauth: {
            ...config.oauth,
            ...(config.oauth.client_id ? { client_id: text(config.oauth.client_id, lookup) } : {}),
            ...(config.oauth.client_secret ? { client_secret: text(config.oauth.client_secret, lookup) } : {}),
          },
        }
      : {}
    return {
      ...config,
      url: text(config.url, lookup),
      ...(config.headers ? { headers: record(config.headers, lookup) } : {}),
      ...oauth,
    }
  } catch (error) {
    if (error instanceof MissingError) return error
    throw error
  }
}

/** Все идентификаторы секретов, на которые ссылаются настройки подключения. */
export function referenced(config: ServerConfig): string[] {
  const values =
    config.type === "local"
      ? [...config.command, ...Object.values(config.environment ?? {})]
      : [
          config.url,
          ...Object.values(config.headers ?? {}),
          ...(config.oauth ? [config.oauth.client_id ?? "", config.oauth.client_secret ?? ""] : []),
        ]
  return [...new Set(values.flatMap((value) => Shape.tokensIn(value)))]
}
