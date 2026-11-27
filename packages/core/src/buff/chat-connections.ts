export * as BuffChatConnectionsPlugin from "./chat-connections.js"

import { Effect, Option, Schema } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffChatConnections } from "@opencode/schema/buff-chat-connections"
import { Tool } from "@opencode/schema/tool"
import { McpTool } from "../tool/mcp.js"
import { BuffLocale } from "./locale.js"
import { BuffShared } from "./shared.js"

/**
 * Подключение, выключенное в одном чате (#969, R13-07): его инструменты уходят из списка модели,
 * вызов (прямой или из кода) отклоняется до запуска, а разрешение на него — запрещено. Действует
 * и в помощниках чата. Остальные чаты подключение видят как прежде.
 */

const KEY = "chat-connections"
const decode = Schema.decodeUnknownOption(BuffChatConnections.State)

/** Сервер, которому принадлежит инструмент реестра с этим именем; не MCP — ничего. */
export function serverOf(
  tools: readonly { readonly id: string; readonly options?: object | undefined }[],
  name: string,
) {
  const tool = tools.find((item) => item.id === name)
  return tool ? McpTool.server(tool) : undefined
}

/** Что сказать модели, когда она тянется к выключенному подключению. */
export const refusal = (server: string) =>
  BuffLocale.t(
    "The user turned the connection «{server}» off in this chat, so its tools are not available here. Do not retry and do not reach the same service another way; tell the user it is off in this chat — only they can turn it back on.",
    { server },
  )

export const register = Effect.fn("BuffChatConnections.register")(function* (ctx: Context) {
  const cell = yield* BuffShared.open<BuffChatConnections.State>({
    storage: ctx.storage,
    key: KEY,
    decode: (stored) => Option.getOrElse(decode(stored), () => BuffChatConnections.EMPTY),
    encode: (state) => JSON.parse(JSON.stringify(state)),
    changed: Effect.void,
  })

  // Сессия и её родители: помощник работает внутри чата, и выключенное там выключено и у него.
  const chain = (sessionID: string) =>
    Effect.gen(function* () {
      const ids: string[] = []
      let next: string | undefined = sessionID
      while (next && !ids.includes(next)) {
        ids.push(next)
        const session: { parentID?: string } | undefined = yield* ctx.session
          .get({ sessionID: next as never })
          .pipe(Effect.orElseSucceed(() => undefined))
        next = session?.parentID
      }
      return ids
    })
  const offIn = (sessionID: string) =>
    Effect.gen(function* () {
      const state = cell.get()
      if (Object.keys(state).length === 0) return new Set<string>()
      return BuffChatConnections.offIn(state, yield* chain(sessionID))
    })
  const blocked = (sessionID: string, name: string) =>
    Effect.gen(function* () {
      const off = yield* offIn(sessionID)
      if (off.size === 0) return undefined
      const server = serverOf(yield* ctx.tool.list(), name)
      return server !== undefined && off.has(server) ? server : undefined
    })

  yield* ctx.rpc
    .register(BuffChatConnections.Rpc, {
      get: (input) => Effect.sync(() => ({ off: cell.get()[input.sessionID] ?? [] })),
      change: (input) =>
        Effect.gen(function* () {
          const next = BuffChatConnections.apply(cell.get(), input)
          yield* cell.set(next)
          return { off: next[input.sessionID] ?? [] }
        }),
    })
    .pipe(Effect.orDie)

  // Модель не видит прямых инструментов выключенного сервера.
  yield* ctx.session.hook("context", (event) =>
    Effect.gen(function* () {
      const off = yield* offIn(event.sessionID)
      if (off.size === 0) return
      const tools = yield* ctx.tool.list()
      for (const name of Object.keys(event.tools)) {
        const server = serverOf(tools, name)
        if (server !== undefined && off.has(server)) delete event.tools[name]
      }
    }),
  )

  // И из каталога режима кода (R14-05): инструменты сервера, запрещённые целиком, ход не видит ни
  // прямыми, ни в каталоге и поиске `execute`.
  yield* ctx.permission.hook("tools", (event) =>
    Effect.gen(function* () {
      const off = yield* offIn(event.sessionID)
      if (off.size === 0) return
      for (const tool of yield* ctx.tool.list()) {
        const server = McpTool.server(tool)
        if (server === undefined || !off.has(server)) continue
        const action = (tool.options as { permission?: string } | undefined)?.permission ?? tool.id
        event.rules.push({ action, resource: "*", effect: "deny" })
      }
    }),
  )

  // Вызов — прямой или из кода — отклоняется до запуска, со словами для модели.
  yield* ctx.tool.hook("execute.before", (event) =>
    Effect.gen(function* () {
      const server = yield* blocked(event.sessionID, event.tool)
      if (server !== undefined) return yield* new Tool.Error({ message: refusal(server) })
    }),
  )

  // И само разрешение: даже правило «разрешить» машины его не откроет.
  yield* ctx.permission.hook("evaluate", (event) =>
    Effect.gen(function* () {
      const server = yield* blocked(event.sessionID, event.action)
      if (server === undefined) return
      event.effect = "deny"
      event.message = refusal(server)
    }),
  )
})

export const Plugin = define<Scope.Scope>({
  id: "buff.chat-connections",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx)
  }),
})
