export * as BuffMcpRules from "./mcp-rules.js"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { Effect, Stream } from "effect"
import type { Scope } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Event as ConfigEvent, type Document } from "@opencode/schema/config"
import { McpEvent } from "@opencode/schema/mcp-event"
import { Global } from "@opencode/util/global"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { Mcp } from "../mcp/index.js"
import type { Permission } from "../permission.js"
import { Tool } from "../tool.js"
import { McpTool } from "../tool/mcp.js"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { machineOf } from "./mobile/api-machine.js"
import { Wildcard } from "../util/wildcard.js"

/**
 * Правила по происхождению сервера (#969). Правило с действием `mcp:<откуда>` относится к
 * инструментам MCP-серверов, записанных в конфигурации этого места: `user` — у пользователя,
 * `local` — в личной папке проекта, `project` — в самом проекте, `managed` — в конфигурации без
 * файла (её отдаёт тот, кто запустил Buff Code). Оно разворачивается в правила на каждый
 * инструмент таких серверов — заново, как только серверы или их инструменты меняются. Так
 * облачная машина, где всё прочее запрещено, разрешает подключения человека на лету, без списка
 * имён и без перезапуска.
 *
 * Имя действия MCP — `<сервер>_<инструмент>`, и оно может совпасть с действием, которое не MCP:
 * сервер `automation` с инструментом `create` дал бы `automation_create` — встроенный инструмент.
 * Такие имена не разворачиваются (R4-01, R5-03): занятыми считаются инструменты реестра без
 * отметки MCP-регистрации — их список берётся заново при каждой перемене реестра, серверов или
 * конфигурации, так что встроенный инструмент закрыт сам, когда бы его ни зарегистрировали, — и
 * действия разрешений без своего инструмента: все действия Buff начинаются с `buff_`, у ядра это
 * `external_directory`. Встроенное разрешается только поимённо.
 */

export type Origin = "user" | "local" | "project" | "managed"

const PREFIX = "mcp:"

/** Откуда сервер: последний документ, где он записан, — так же выбирает и само ядро. */
export function origin(documents: readonly Document[], configDir: string, server: string): Origin | undefined {
  const document = documents.findLast((item) => Object.hasOwn(item.info.mcp?.servers ?? {}, server))
  if (!document) return undefined
  if (document.path === undefined) return "managed"
  const relative = path.relative(configDir, path.dirname(document.path))
  if (relative === "") return "user"
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return "local"
  return "project"
}

export interface Served {
  readonly server: string
  readonly origin: Origin | undefined
  readonly tools: readonly string[]
}

/** Действия разрешений без своего инструмента: у Buff — по приставке, у ядра — поимённо. */
const ACTION_PREFIX = "buff_"
const ACTIONS: readonly string[] = ["external_directory"]

interface Registered {
  readonly id: string
  readonly options?: object | undefined
}

/**
 * Инструменты реестра, которые не инструменты MCP-серверов: встроенные и плагинов. MCP-инструмент
 * узнаётся по отметке, которую ставит его регистрация (`McpTool.options`), а не по пространству
 * имён и имени: встроенный инструмент с тем же пространством, что у сервера человека, — встроенный.
 */
export function builtins(tools: readonly Registered[]): string[] {
  return tools.filter((tool) => McpTool.server(tool) === undefined).map((tool) => tool.id)
}

/** Занято ли имя действием, которое не MCP: такое правило по происхождению не открывает. */
export function reserved(builtin: Iterable<string>): (action: string) => boolean {
  const taken = new Set([...builtin, ...ACTIONS])
  return (action) => taken.has(action) || action.startsWith(ACTION_PREFIX)
}

/** Правила `mcp:<откуда>` — на их месте правила на каждый инструмент подходящих серверов. */
export function expand(
  rules: Permission.Ruleset,
  servers: readonly Served[],
  taken: (action: string) => boolean,
): Permission.Ruleset {
  if (!rules.some((rule) => rule.action.startsWith(PREFIX))) return rules
  return rules.flatMap((rule) => {
    if (!rule.action.startsWith(PREFIX)) return [rule]
    const pattern = rule.action.slice(PREFIX.length)
    return servers
      .filter((item) => item.origin !== undefined && Wildcard.match(item.origin, pattern))
      .flatMap((item) =>
        item.tools
          .map((tool) => McpTool.name(item.server, tool))
          .filter((action) => !taken(action))
          .map((action) => ({ action, resource: rule.resource, effect: rule.effect })),
      )
  })
}

/**
 * Серверы человека сверх предела оператора (R15-02, R16-02): все после первых `max` — сначала
 * в порядке, в котором человек их добавлял (`order`, из `buff.mcp`), потом остальные по имени.
 * Предел держится на самой машине — агент может записать файл конфигурации оболочкой, минуя экран,
 * и такой сервер не вытеснит добавленный человеком.
 */
export function overLimit(userServers: readonly string[], max: number, order: readonly string[] = []): Set<string> {
  if (!Number.isFinite(max)) return new Set()
  return new Set(BuffMcp.ranked(userServers, order).slice(Math.max(0, max)))
}

/** Серверы сверх предела — без происхождения: правило «mcp:user» их не открывает. */
export function limit(servers: readonly Served[], over: ReadonlySet<string>): Served[] {
  return servers.map((item) => (item.origin === "user" && over.has(item.server) ? { ...item, origin: undefined } : item))
}

/** Серверы человека сверх предела — по всем документам конфигурации, подключённые или нет. */
export function overOf(documents: readonly Document[], configDir: string, max: number, order: readonly string[]): Set<string> {
  const names = [...new Set(documents.flatMap((item) => Object.keys(item.info.mcp?.servers ?? {})))]
  return overLimit(
    names.filter((server) => origin(documents, configDir, server) === "user"),
    max,
    order,
  )
}

/** Сверх предела — не подключать вовсе (R16-02): сервер в списке ядра выключен, как выключенный человеком. */
export function switchOff(
  editor: {
    get(name: string): { disabled?: boolean } | undefined
    update(name: string, change: (server: { disabled?: boolean }) => void): void
  },
  over: ReadonlySet<string>,
): void {
  for (const name of over)
    if (editor.get(name))
      editor.update(name, (server) => {
        server.disabled = true
      })
}

export const Plugin = define<Bus.Service | Config.Service | Mcp.Service | Global.Service | Tool.Service | Scope.Scope>({
  id: "buff.mcp-rules",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const mcp = yield* Mcp.Service
    const global = yield* Global.Service
    const tools = yield* Tool.Service
    // На облачной машине — предел подключений человека от оператора; у себя на компьютере его нет.
    const machine = machineOf(process.env, global.home)
    const userMax = machine.cloud ? machine.limits.mcpServersMax : Infinity
    /** Серверы человека сверх предела: ядро их не подключает (R16-02). */
    let over = new Set<string>()
    let served: Served[] = []
    let builtin: string[] = []
    /** Есть ли где-то правила по происхождению: без них (обычное окно) агентов незачем пересобирать. */
    let selective = false

    const read = Effect.gen(function* () {
      const documents = (yield* config.entries()).filter((entry): entry is Document => entry.type === "document")
      const byServer = new Map<string, string[]>()
      for (const tool of yield* mcp.tools()) byServer.set(tool.server, [...(byServer.get(tool.server) ?? []), tool.name])
      // In a fixed order: the same catalog in another order is no change and reloads no agent.
      const all = [...byServer]
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([server, tools]) => ({ server, origin: origin(documents, global.config, server), tools: tools.toSorted() }))
      // Предел оператора (R15-02, R16-02) — по всем серверам человека, в порядке их добавления.
      const order = BuffMcp.parseOrder(
        yield* Effect.promise(() => readFile(path.join(global.config, BuffMcp.ORDER_FILE), "utf8").catch(() => undefined)),
      )
      const nextOver = overOf(documents, global.config, userMax, order)
      const overChanged = [...nextOver].join("\0") !== [...over].join("\0")
      over = nextOver
      if (overChanged) yield* ctx.mcp.reload()
      const next = limit(all, over)
      const nextBuiltin = builtins(yield* ctx.tool.list()).toSorted()
      const changed = JSON.stringify([next, nextBuiltin]) !== JSON.stringify([served, builtin])
      served = next
      builtin = nextBuiltin
      return changed
    })

    const refresh = read.pipe(
      Effect.flatMap((changed) => (changed && selective ? ctx.agent.reload() : Effect.void)),
      Effect.catchCause((cause) => Effect.logWarning("Buff: MCP rules were not refreshed", { cause })),
    )

    // Подписка — до первого чтения: изменения, пришедшие во время него, не теряются. Реестр
    // инструментов — тоже: инструмент, зарегистрированный позже, занимает своё имя сразу.
    const registry = yield* tools.changes()
    yield* Stream.merge(bus.subscribe([McpEvent.ToolsChanged, McpEvent.StatusChanged, ConfigEvent.Updated]), registry).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => refresh),
      Effect.forkScoped({ startImmediately: true }),
    )

    // Сверх предела — не подключать: сервер выключен в списке ядра, как выключенный человеком.
    // Предел есть только на облачной машине.
    if (Number.isFinite(userMax)) yield* ctx.mcp.transform((editor) => switchOff(editor, over))

    // Последним среди правил агентов: сюда приходят и правила конфигурации, и правила режимов.
    yield* read
    yield* ctx.agent.transform((editor) => {
      selective = false
      const taken = reserved(builtin)
      for (const agent of editor.list())
        editor.update(agent.id, (item) => {
          if (item.permissions.some((rule) => rule.action.startsWith(PREFIX))) selective = true
          item.permissions = [...expand(item.permissions, served, taken)]
        })
    })
  }),
})
