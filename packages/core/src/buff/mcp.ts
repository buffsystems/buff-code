export * as BuffMcpPlugin from "./mcp.js"

import path from "node:path"
import { Duration, Effect, Option, Schema } from "effect"
import type { Scope } from "effect"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { BuffConnection } from "@opencode/schema/buff-connection"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { BuffSkill } from "@opencode/schema/buff-skill"
import { ServerConfig } from "@opencode/schema/mcp"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Event as ConfigEvent } from "@opencode/schema/config"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { BuffConfigFiles } from "./config-files.js"
import { BuffConnectionScript } from "./connection-script.js"
import { Mcp } from "../mcp/index.js"
import { BuffMcpFile } from "./mcp-file.js"
import { BuffProjectDir } from "./project-dir.js"
import { BuffLocale } from "./locale.js"

/**
 * Управление MCP-серверами из интерфейса (#444). Серверы по-прежнему живут в файлах
 * конфигурации — пользователя (все проекты) или проекта — и подключаются сами, когда файл
 * меняется; здесь их читают и правят по просьбе экранов. Серверы, которых в файлах нет,
 * подключил сам Buff Code: они видны, но не правятся. Третье место (#951) — личная папка
 * проекта: сервер у пользователя, но только для этого проекта; при смене области вместе с
 * записью переезжают скрипт подключения и инструкции к нему.
 */

type Target = { readonly scope: BuffMcp.Scope; readonly name: string }
type Placed = { readonly scope: BuffMcp.Scope; readonly file: string; readonly raw: unknown }

const decodeConfig = Schema.decodeUnknownOption(ServerConfig)
const { refuse } = BuffConfigFiles

export interface Options {
  /** Сколько ждать, пока изменённый файл перечитают и серверы переподключатся. */
  readonly settle: Duration.Input
  /**
   * Попросить ядро перечитать конфигурацию во всех открытых местах (#969): правка из интерфейса
   * не ждёт наблюдателя за файлами — в песочнице облачной машины он не работает вовсе.
   */
  readonly reread: Effect.Effect<void>
  /** Каталог конфигурации пользователя — общий для всех проектов. */
  readonly userDirectory: string
  /** Личная папка проекта (#951); вне проекта её нет. */
  readonly localDirectory?: string | undefined
}

export const register = Effect.fn("BuffMcp.register")(function* (ctx: Context, options: Options) {
  const mcp = yield* Mcp.Service
  const fs = yield* FSUtil.Service
  const skills = ctx.rpc(BuffSkill.Rpc)
  const { scopeOf, text, files, fileFor, rewrite, write } = BuffConfigFiles.make<BuffMcp.Scope>({
    config: yield* Config.Service,
    fs,
    dirs: { user: options.userDirectory, project: ctx.location.directory, local: options.localDirectory },
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

  // Порядок, в котором человек добавлял свои серверы (R16-02): по нему предел оператора оставляет
  // первые добавленные. Рядом с конфигурацией пользователя.
  const orderFile = path.join(options.userDirectory, BuffMcp.ORDER_FILE)
  const order = text(orderFile).pipe(Effect.map(BuffMcp.parseOrder))
  const reorder = (change: (order: string[]) => string[]) =>
    Effect.gen(function* () {
      const before = yield* order
      const after = change(before)
      if (JSON.stringify(after) !== JSON.stringify(before)) yield* write(orderFile, JSON.stringify({ order: after }) + "\n")
    })

  const list = Effect.gen(function* () {
    const where = yield* placed
    const added = yield* order
    const statuses = new Map((yield* mcp.servers()).map((server) => [String(server.name), server.status]))
    const own = [...where].map(
      ([name, at]): BuffMcp.Entry => ({
        name,
        scope: at.scope,
        file: at.file,
        config: Option.getOrUndefined(decodeConfig(at.raw)),
        // Файл уже изменён, а ядро сервер ещё не подняло — это «подключается».
        status: statuses.get(name) ?? { status: "pending" },
        ...(at.scope === "user" && added.includes(name) ? { added: added.indexOf(name) } : {}),
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

  /** Где лежит скрипт подключения области: в личной папке проекта либо у пользователя. */
  const scriptFiles = (target: Target) => {
    const directory = target.scope === "local" ? options.localDirectory : options.userDirectory
    return directory === undefined ? undefined : BuffConnectionScript.paths(directory, target.name)
  }

  /** Скрипт — в папку новой области (с раннером); старый файл убирается, когда запись уже переехала. */
  const scriptMove = Effect.fnUntraced(function* (serverConfig: ServerConfig, previous: Target, next: Target) {
    const from = scriptFiles(previous)
    const to = scriptFiles(next)
    const config = from && to ? BuffConnectionScript.moved(serverConfig, from, to) : undefined
    const code = from && config ? yield* text(from.script) : undefined
    if (!from || !to || !config || code === undefined) return undefined
    if (BuffConnectionScript.stale(yield* text(to.runner))) yield* write(to.runner, BuffConnectionScript.stamped)
    yield* write(to.script, code)
    return { config, drop: fs.remove(from.script, { force: true }).pipe(Effect.ignore) }
  })

  /** Инструкции к подключению (навык) — в ту же область, что и оно; нет инструкций — нечего нести. */
  const instructionsMove = (previous: Target, next: Target) => {
    const from = { scope: previous.scope, id: BuffConnection.skillID(previous.name) }
    return skills.read(from).pipe(
      Effect.flatMap((parts) =>
        skills.save({ scope: next.scope, id: BuffConnection.skillID(next.name), ...parts, previous: from }),
      ),
      Effect.ignore,
    )
  }

  const check = Effect.fnUntraced(function* (name: string, serverConfig?: ServerConfig) {
    const problem =
      BuffMcp.nameProblem(name, BuffLocale.t) ??
      (serverConfig ? BuffMcp.configProblem(serverConfig, BuffLocale.t) : undefined)
    if (problem) return yield* refuse("invalid", problem)
  })

  const settled = options.reread.pipe(Effect.andThen(Effect.sleep(options.settle)))

  let changed: Effect.Effect<void> = Effect.void
  const registration = yield* ctx.rpc
    .register(BuffMcp.Rpc, {
      list: () => list,
      save: (input, call) =>
        Effect.gen(function* () {
          yield* check(input.name, input.config)
          const current = (yield* placed).get(input.name)
          const file = current?.scope === input.scope ? current.file : yield* fileFor(input.scope)
          const previous = input.previous
          const rescoped = previous && previous.scope !== input.scope ? previous : undefined
          const script = rescoped ? yield* scriptMove(input.config, rescoped, input) : undefined
          yield* rewrite(file, (before) => BuffMcpFile.withServer(before, input.name, script?.config ?? input.config))
          if (previous && (previous.scope !== input.scope || previous.name !== input.name))
            yield* erase(previous.scope, previous.name)
          if (script) yield* script.drop
          if (rescoped) yield* instructionsMove(rescoped, input)
          const renamed = previous?.scope === "user" ? previous.name : undefined
          if (input.scope === "user") yield* reorder((names) => BuffMcp.orderAdded(names, input.name, renamed))
          else if (renamed) yield* reorder((names) => BuffMcp.orderRemoved(names, renamed))
          yield* settled
          yield* changed
          return undefined
        }).pipe(Effect.mapError((refusal) => call.error(refusal.kind, refusal.message, {}))),
      remove: (input, call) =>
        Effect.gen(function* () {
          yield* check(input.name)
          yield* erase(input.scope, input.name)
          if (input.scope === "user") yield* reorder((names) => BuffMcp.orderRemoved(names, input.name))
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

/** «Конфигурация изменилась» без места: её перечитывает каждое открытое место — и переподключает серверы. */
export const reread = (bus: Bus.Interface) => bus.publish(ConfigEvent.Updated, {}, { global: true }).pipe(Effect.asVoid)

export const Plugin = define<Bus.Service | Config.Service | Mcp.Service | FSUtil.Service | Global.Service | Scope.Scope>({
  id: "buff.mcp",
  // Правка перечитывается сразу, не дожидаясь наблюдателя; ядро затем переподключает серверы.
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    yield* register(ctx, {
      reread: reread(yield* Bus.Service),
      settle: "400 millis",
      userDirectory: global.config,
      localDirectory: yield* BuffProjectDir.personalFor(ctx.location.project),
    })
  }),
})
