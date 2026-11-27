// Правила по происхождению MCP-сервера (#969): облачная машина разрешает подключения человека
// на лету, а встроенные действия, которых нет в списке, остаются запрещены.
import { describe, expect, test } from "bun:test"
import type { AgentEditor } from "@opencode/plugin/effect/agent"
import { Global } from "@opencode/util/global"
import { Effect, Layer, PubSub, Stream } from "effect"
import { Document } from "@opencode/schema/config"
import { AbsolutePath } from "@opencode/schema/schema"
import { BuffMcpRules } from "../../src/buff/mcp-rules"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config"
import { Mcp } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Tool as ToolRegistry } from "../../src/tool"
import type { Tool } from "../../src/tool"
import { McpTool } from "../../src/tool/mcp"
import { it } from "../lib/effect"
import { host } from "../plugin/host"

/** Параметры, с которыми ядро регистрирует инструмент MCP-сервера: с отметкой сервера. */
const mcp = (server: string, name: string) =>
  McpTool.options({ server: Mcp.ServerName.make(server), name, inputSchema: { type: "object" } })

const CONFIG = "/home/u/.config/buff"
const doc = (servers: string[], file?: string) =>
  new Document({
    type: "document",
    ...(file ? { path: AbsolutePath.make(file) } : {}),
    info: { mcp: { servers: Object.fromEntries(servers.map((name) => [name, { type: "remote", url: "https://x.example/mcp" }])) } },
  } as never)

describe("origin: where a server is written", () => {
  const documents = [
    doc(["github", "shared"], `${CONFIG}/buffcode.jsonc`),
    doc(["mine"], `${CONFIG}/projects/p1/buffcode.json`),
    doc(["repo", "shared"], "/home/u/work/app/.buffcode/buffcode.json"),
    doc(["draw"]),
  ]
  test("the user's config, the project's personal folder, the project, a config without a file", () => {
    expect(BuffMcpRules.origin(documents, CONFIG, "github")).toBe("user")
    expect(BuffMcpRules.origin(documents, CONFIG, "mine")).toBe("local")
    expect(BuffMcpRules.origin(documents, CONFIG, "repo")).toBe("project")
    expect(BuffMcpRules.origin(documents, CONFIG, "draw")).toBe("managed")
  })
  test("the last document wins, as it does for the engine; a server from no config has no origin", () => {
    expect(BuffMcpRules.origin(documents, CONFIG, "shared")).toBe("project")
    expect(BuffMcpRules.origin(documents, CONFIG, "buff")).toBeUndefined()
  })
  test("a folder next to the config folder is not inside it", () => {
    expect(BuffMcpRules.origin([doc(["x"], `${CONFIG}-old/buffcode.json`)], CONFIG, "x")).toBe("project")
  })
})

describe("expand: an origin rule becomes a rule per tool", () => {
  const served: BuffMcpRules.Served[] = [
    { server: "github", origin: "user", tools: ["list_issues", "create.issue"] },
    { server: "draw", origin: "managed", tools: ["draw_image"] },
    { server: "repo", origin: "project", tools: ["run"] },
    { server: "buff", origin: undefined, tools: ["search"] },
    // Сервер с именем встроенного действия не открывает само действие: правило — на его инструменты.
    { server: "external", origin: "user", tools: ["fetch"] },
  ]
  const cloud: Permission.Ruleset = [
    { action: "*", resource: "*", effect: "deny" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "external_directory", resource: "*", effect: "deny" },
    { action: "mcp:user", resource: "*", effect: "allow" },
    { action: "mcp:managed", resource: "*", effect: "allow" },
  ]
  const rules = BuffMcpRules.expand(cloud, served, BuffMcpRules.reserved([]))
  const effect = (action: string) => Permission.evaluate(action, "*", rules).effect

  test("the person's servers and the service's own are allowed, tool by tool", () => {
    expect(effect("github_list_issues")).toBe("allow")
    expect(effect("github_create_issue")).toBe("allow")
    expect(effect("draw_draw_image")).toBe("allow")
  })
  test("a project's server, a server from no config and unknown actions stay denied", () => {
    expect(effect("repo_run")).toBe("deny")
    expect(effect("buff_search")).toBe("deny")
    expect(effect("some_new_builtin")).toBe("deny")
    expect(effect("external_directory")).toBe("deny")
    expect(effect("external_fetch")).toBe("allow")
  })
  test("the rule keeps its place, so a later rule still wins", () => {
    const later = BuffMcpRules.expand(
      [{ action: "mcp:*", resource: "*", effect: "allow" }, { action: "github_create_issue", resource: "*", effect: "deny" }],
      served,
      BuffMcpRules.reserved([]),
    )
    expect(Permission.evaluate("github_create_issue", "*", later).effect).toBe("deny")
    expect(Permission.evaluate("github_list_issues", "*", later).effect).toBe("allow")
    expect(Permission.evaluate("repo_run", "*", later).effect).toBe("allow")
  })
  test("no origin rules — the very same rules back; none of the origin rules is left", () => {
    const plain: Permission.Ruleset = [{ action: "*", resource: "*", effect: "ask" }]
    expect(BuffMcpRules.expand(plain, served, BuffMcpRules.reserved([]))).toBe(plain)
    expect(rules.some((rule) => rule.action.startsWith("mcp:"))).toBe(false)
    expect(BuffMcpRules.expand(cloud, [], BuffMcpRules.reserved([]))).toEqual(cloud.slice(0, 3))
  })
})

// R4-01: правило на инструмент человека не должно совпасть с действием, которое не MCP.
describe("expand never opens a built-in action", () => {
  const cloud: Permission.Ruleset = [
    { action: "*", resource: "*", effect: "deny" },
    { action: "mcp:user", resource: "*", effect: "allow" },
  ]
  const tools = [
    { id: "automation_create", name: "automation_create", options: {} },
    { id: "memory_save", name: "memory_save" },
    { id: "read", name: "read" },
    { id: "automation_list", name: "list", options: mcp("automation", "list") },
    { id: "github_list_issues", name: "list_issues", options: mcp("github", "list_issues") },
  ]
  const served: BuffMcpRules.Served[] = [
    { server: "automation", origin: "user", tools: ["create", "list"] },
    { server: "memory", origin: "user", tools: ["save", "create_entities"] },
    { server: "buff", origin: "user", tools: ["workflow", "connection_save"] },
    { server: "external", origin: "user", tools: ["directory"] },
    { server: "github", origin: "user", tools: ["list_issues"] },
  ]

  test("registered tools that are not a served MCP tool are the built-ins", () => {
    expect(BuffMcpRules.builtins(tools)).toEqual(["automation_create", "memory_save", "read"])
  })

  const rules = BuffMcpRules.expand(cloud, served, BuffMcpRules.reserved(BuffMcpRules.builtins(tools)))
  const effect = (action: string) => Permission.evaluate(action, "*", rules).effect

  test("a server tool named like a built-in tool stays denied", () => {
    expect(effect("automation_create")).toBe("deny")
    expect(effect("memory_save")).toBe("deny")
  })
  test("a server tool named like a built-in permission action stays denied", () => {
    expect(effect("buff_workflow")).toBe("deny")
    expect(effect("buff_connection_save")).toBe("deny")
    expect(effect("external_directory")).toBe("deny")
  })
  test("the same servers' other tools are still allowed", () => {
    expect(effect("automation_list")).toBe("allow")
    expect(effect("memory_create_entities")).toBe("allow")
    expect(effect("github_list_issues")).toBe("allow")
  })
})

// R5-03: MCP-инструмент узнаётся по отметке, которую ставит его регистрация, а не по имени.
describe("builtins: only a tool registered by an MCP server is not a built-in", () => {
  test("a namespaced built-in whose namespace and name match a served server's tool is still a built-in", () => {
    const tools = [
      { id: "browser_open", name: "open", options: { namespace: "browser", permission: "browser" } },
      { id: "browser_click", name: "click", options: mcp("browser", "click") },
    ]
    expect(BuffMcpRules.builtins(tools)).toEqual(["browser_open"])
    const rules = BuffMcpRules.expand(
      [{ action: "*", resource: "*", effect: "deny" }, { action: "mcp:user", resource: "*", effect: "allow" }],
      [{ server: "browser", origin: "user", tools: ["open", "click"] }],
      BuffMcpRules.reserved(BuffMcpRules.builtins(tools)),
    )
    expect(Permission.evaluate("browser_open", "*", rules).effect).toBe("deny")
    expect(Permission.evaluate("browser_click", "*", rules).effect).toBe("allow")
  })
  test("the mark is the tool's own: a plain object with the same fields carries none", () => {
    expect(McpTool.server({ options: { namespace: "github" } })).toBeUndefined()
    expect(McpTool.server({ options: mcp("github", "list_issues") })).toBe("github")
  })
})

// R5-03: инструмент, зарегистрированный позже (вне активации плагинов), закрывается сразу, без
// события MCP или конфигурации: правила пересобираются, как только меняется реестр.
type Registered = { id: string; name: string; options?: Tool.Options }
const served = (server: string, name: string) => ({ server: Mcp.ServerName.make(server), name, inputSchema: { type: "object" } as const })

/** The plugin over fakes: the registry, the MCP catalog and a registry change are set by the test. */
const rig = Effect.fn(function* (state: { registered: Registered[]; catalog: ReturnType<typeof served>[] }) {
  const changes = yield* PubSub.unbounded<void>()
  let reloads = 0
  let transform: ((editor: AgentEditor) => void) | undefined
  const base = host()
  yield* BuffMcpRules.Plugin.effect(
    host({
      tool: { ...base.tool, list: () => Effect.sync(() => state.registered as never) },
      agent: {
        ...base.agent,
        reload: () => Effect.sync(() => void reloads++),
        transform: (callback) =>
          Effect.sync(() => {
            transform = callback
            return { dispose: Effect.void }
          }),
      },
    }),
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(Bus.Service, { subscribe: () => Stream.never }),
        Layer.mock(Config.Service, {
          entries: () => Effect.succeed([doc(["automation", "github"], `${CONFIG}/buffcode.jsonc`)]),
        }),
        Layer.mock(Mcp.Service, { tools: () => Effect.sync(() => state.catalog) }),
        Layer.mock(Global.Service, { config: CONFIG } as never),
        Layer.mock(ToolRegistry.Service, {
          changes: () => PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
        }),
      ),
    ),
  )
  const effect = (action: string) => {
    const agent = {
      id: "build",
      permissions: [
        { action: "*", resource: "*", effect: "deny" as const },
        { action: "mcp:user", resource: "*", effect: "allow" as const },
      ],
    }
    const editor = {
      list: () => [agent],
      update: (_id: string, update: (item: typeof agent) => void) => update(agent),
    }
    transform?.(editor as never)
    return Permission.evaluate(action, "*", agent.permissions).effect
  }
  /** A registry change, then the debounced re-read: how many agent reloads it caused. */
  const change = Effect.fn(function* () {
    const before = reloads
    yield* PubSub.publish(changes, undefined)
    for (let wait = 0; reloads === before && wait < 15; wait++) yield* Effect.sleep("20 millis")
    return reloads - before
  })
  return { effect, change }
})

// R5-03: инструмент, зарегистрированный позже (вне активации плагинов), закрывается сразу, без
// события MCP или конфигурации: правила пересобираются, как только меняется реестр.
describe("the rules follow the tool registry", () => {
  it.live("a built-in registered later under a served tool's id is reserved at once", () =>
    Effect.gen(function* () {
      const state = {
        registered: [
          { id: "automation_create", name: "create", options: mcp("automation", "create") },
          { id: "automation_list", name: "list", options: mcp("automation", "list") },
        ] as Registered[],
        catalog: [served("automation", "create"), served("automation", "list")],
      }
      const { effect, change } = yield* rig(state)
      expect(effect("automation_create")).toBe("allow")

      state.registered = [{ id: "automation_create", name: "automation_create" }, state.registered[1]!]
      expect(yield* change()).toBe(1)
      expect(effect("automation_create")).toBe("deny")
      expect(effect("automation_list")).toBe("allow")
    }),
  )

  // R6 (critic's note): the MCP catalog in another order is the same catalog — no agent reload.
  it.live("the same servers and tools in another order cause no reload", () =>
    Effect.gen(function* () {
      const state = {
        registered: [] as Registered[],
        catalog: [served("github", "list_issues"), served("automation", "list"), served("automation", "create")],
      }
      const { effect, change } = yield* rig(state)
      expect(effect("github_list_issues")).toBe("allow")
      state.catalog = [...state.catalog].reverse()
      expect(yield* change()).toBe(0)
      expect(effect("automation_create")).toBe("allow")
    }),
  )
})

// R15-02 (#969): the operator's limit of a person's connections holds on the machine itself — the
// agent can write the config file with its shell, so the rules open only the first N of the
// person's servers (by name), whatever wrote them.
describe("the operator's limit of a person's connections", () => {
  test("only the first N servers of the person are kept as theirs — added first, then by name", () => {
    expect([...BuffMcpRules.overLimit(["zeta", "alpha", "mid"], 2)]).toEqual(["zeta"])
    // R16-02: a server the agent writes with an early name does not push out one the person added.
    expect([...BuffMcpRules.overLimit(["aaa", "github"], 1, ["github"])]).toEqual(["aaa"])
    expect([...BuffMcpRules.overLimit(["a", "b"], 5)]).toEqual([])
    expect([...BuffMcpRules.overLimit(["a", "b"], 0)]).toEqual(["a", "b"])
  })
  test("a server over the limit gets no rules; the service's own are not counted", () => {
    const served: BuffMcpRules.Served[] = [
      { server: "alpha", origin: "user", tools: ["x"] },
      { server: "beta", origin: "user", tools: ["y"] },
      { server: "draw", origin: "managed", tools: ["draw_image"] },
    ]
    const limited = BuffMcpRules.limit(served, BuffMcpRules.overLimit(["alpha", "beta"], 1))
    const rules = BuffMcpRules.expand(
      [{ action: "*", resource: "*", effect: "deny" }, { action: "mcp:*", resource: "*", effect: "allow" }],
      limited,
      BuffMcpRules.reserved([]),
    )
    expect(Permission.evaluate("alpha_x", "*", rules).effect).toBe("allow")
    expect(Permission.evaluate("beta_y", "*", rules).effect).toBe("deny")
    expect(Permission.evaluate("draw_draw_image", "*", rules).effect).toBe("allow")
    expect(BuffMcpRules.limit(served, BuffMcpRules.overLimit(["alpha", "beta"], Infinity))).toEqual(served)
  })
})

// R16-02: a server over the limit is not connected at all on a cloud machine — not only without
// tools: its process is not started and nothing is called.
describe("servers over the limit are not connected", () => {
  test("the person's servers over the limit, by the order they were added, among all documents", () => {
    const documents = [doc(["aaa", "github", "notion"], `${CONFIG}/buffcode.jsonc`), doc(["repo"], "/w/app/buffcode.json"), doc(["draw"])]
    expect([...BuffMcpRules.overOf(documents, CONFIG, 1, ["notion"])].toSorted()).toEqual(["aaa", "github"])
    expect([...BuffMcpRules.overOf(documents, CONFIG, Infinity, [])]).toEqual([])
  })
  test("they are turned off in the engine's server list", () => {
    const servers = new Map<string, { disabled?: boolean }>([["aaa", {}], ["github", {}], ["draw", {}]])
    BuffMcpRules.switchOff(
      {
        get: (name) => servers.get(name),
        update: (name, change) => {
          const server = servers.get(name)
          if (server) change(server)
        },
      },
      new Set(["aaa", "missing"]),
    )
    expect([...servers].map(([name, s]) => [name, s.disabled === true])).toEqual([["aaa", true], ["github", false], ["draw", false]])
  })
})

