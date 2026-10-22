export * as BuffMcpPlugin from "./mcp.js"

import { Duration, Effect, Option, Schema } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { ServerConfig } from "@opencode/schema/mcp"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Config } from "../config.js"
import { BuffConfigFiles } from "./config-files.js"
import { Mcp } from "../mcp/index.js"
import { BuffMcpFile } from "./mcp-file.js"
import { BuffLocale } from "./locale.js"

/**
 * Управление MCP-серверами из интерфейса (#444). Серверы по-прежнему живут в файлах
 * конфигурации — пользователя (все проекты) или проекта — и подключаются сами, когда файл
 * меняется; здесь их читают и правят по просьбе экранов. Серверы, которых в файлах нет,
 * подключил сам Buff Code: они видны, но не правятся.
 */

type Placed = { readonly scope: BuffMcp.Scope; readonly file: string; readonly raw: unknown }

const decodeConfig = Schema.decodeUnknownOption(ServerConfig)
const { refuse } = BuffConfigFiles

export interface Options {
  /** Сколько ждать, пока изменённый файл перечитают и серверы переподключатся. */
  readonly settle: Duration.Input
  /** Каталог конфигурации пользователя — общий для всех проектов. */
  readonly userDirectory: string
}

export const register = Effect.fn("BuffMcp.register")(function* (ctx: Context, options: Options) {
  const mcp = yield* Mcp.Service
  const { scopeOf, text, files, fileFor, rewrite } = BuffConfigFiles.make({
    config: yield* Config.Service,
    fs: yield* FSUtil.Service,
    dirs: { user: options.userDirectory, project: ctx.location.directory },
  })

  /** Где записан каждый сервер; при повторе побеждает более сильный файл. */
  const placed = Effect.gen(function* () {
    const found = new Map<string, Placed>()
    for (const file of yield* files) {
      const content = (yield* text(file)) ?? ""
      // Файл, который не читается, серверов не даёт — как и для самого ядра.
      const servers = yield* Effect.try(() => BuffMcpFile.servers(content)).pipe(Effect.orElseSucceed(() => ({})))
      for (const [name, raw] of Object.entries(servers)) found.set(name, { scope: scopeOf(file), file, raw })
    }
    return found
  })

  const list = Effect.gen(function* () {
    const where = yield* placed
    const statuses = new Map((yield* mcp.servers()).map((server) => [String(server.name), server.status]))
    const own = [...where].map(
      ([name, at]): BuffMcp.Entry => ({
        name,
        scope: at.scope,
        file: at.file,
        config: Option.getOrUndefined(decodeConfig(at.raw)),
        // Файл уже изменён, а ядро сервер ещё не подняло — это «подключается».
        status: statuses.get(name) ?? { status: "pending" },
      }),
    )
    const builtin = [...statuses]
      .filter(([name]) => !where.has(name))
      .map(([name, status]): BuffMcp.Entry => ({ name, scope: "builtin", status }))
    return [...own, ...builtin]
  })

  /** Убрать сервер из всех файлов области: иначе из-под удалённого «всплывёт» запись слабее. */
  const erase = Effect.fnUntraced(function* (scope: BuffMcp.Scope, name: string) {
    for (const file of (yield* files).filter((item) => scopeOf(item) === scope))
      yield* rewrite(file, (before) => BuffMcpFile.withServer(before, name, undefined))
  })

  const check = Effect.fnUntraced(function* (name: string, serverConfig?: ServerConfig) {
    const problem =
      BuffMcp.nameProblem(name, BuffLocale.t) ??
      (serverConfig ? BuffMcp.configProblem(serverConfig, BuffLocale.t) : undefined)
    if (problem) return yield* refuse("invalid", problem)
  })

  const settled = Effect.sleep(options.settle)

  let changed: Effect.Effect<void> = Effect.void
  const registration = yield* ctx.rpc
    .register(BuffMcp.Rpc, {
      list: () => list,
      save: (input, call) =>
        Effect.gen(function* () {
          yield* check(input.name, input.config)
          const current = (yield* placed).get(input.name)
          const file = current?.scope === input.scope ? current.file : yield* fileFor(input.scope)
          yield* rewrite(file, (before) => BuffMcpFile.withServer(before, input.name, input.config))
          const previous = input.previous
          if (previous && (previous.scope !== input.scope || previous.name !== input.name))
            yield* erase(previous.scope, previous.name)
          yield* settled
          yield* changed
          return undefined
        }).pipe(Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {}))),
      remove: (input, call) =>
        Effect.gen(function* () {
          yield* check(input.name)
          yield* erase(input.scope, input.name)
          yield* settled
          yield* changed
          return undefined
        }).pipe(Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {}))),
      enable: (input, call) =>
        Effect.gen(function* () {
          yield* check(input.name)
          const current = (yield* placed).get(input.name)
          if (!current || current.scope !== input.scope)
            return yield* refuse(
              "invalid",
              BuffLocale.t("There is no server «{name}» in this scope.", { name: input.name }),
            )
          yield* rewrite(current.file, (before) => BuffMcpFile.withEnabled(before, input.name, input.enabled))
          yield* settled
          yield* changed
          return undefined
        }).pipe(Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {}))),
    })
    .pipe(Effect.orDie)
  changed = registration.events.emit("changed", {}).pipe(Effect.ignore)
})

export const Plugin = define<Config.Service | Mcp.Service | FSUtil.Service | Global.Service | Scope.Scope>({
  id: "buff.mcp",
  // Ядро перечитывает изменённый файл с задержкой и затем переподключает серверы.
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx, { settle: "400 millis", userDirectory: (yield* Global.Service).config })
  }),
})
