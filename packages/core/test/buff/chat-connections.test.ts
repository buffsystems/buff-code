// Подключение, выключенное в одном чате (#969, R13-07): модель не видит его инструментов, вызов
// отклоняется до запуска, разрешение запрещено — в этом чате и его помощниках, но не в других.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { BuffChatConnections } from "@opencode/schema/buff-chat-connections"
import { Mcp } from "../../src/mcp"
import { McpTool } from "../../src/tool/mcp"
import { BuffChatConnectionsPlugin } from "../../src/buff/chat-connections"
import { BuffShared } from "../../src/buff/shared"
import { it } from "../lib/effect"
import { host } from "../plugin/host"

const mcp = (server: string, name: string) =>
  McpTool.options({ server: Mcp.ServerName.make(server), name, inputSchema: { type: "object" } })

describe("the per-chat state", () => {
  test("off and back on; a chat with nothing off leaves the record", () => {
    const off = BuffChatConnections.apply({}, { sessionID: "s1", server: "mail", on: false })
    expect(off).toEqual({ s1: ["mail"] })
    expect(BuffChatConnections.apply(off, { sessionID: "s1", server: "mail", on: false })).toEqual({ s1: ["mail"] })
    expect(BuffChatConnections.apply(off, { sessionID: "s1", server: "mail", on: true })).toEqual({})
  })
  test("a helper sees what its chat turned off", () => {
    const state = { parent: ["mail"], other: ["docs"] }
    expect([...BuffChatConnections.offIn(state, ["helper", "parent"])]).toEqual(["mail"])
  })
})

const rig = Effect.fn(function* () {
  BuffShared.forget("chat-connections")
  const stored = new Map<string, unknown>()
  const hooks: Record<string, (event: never) => Effect.Effect<unknown, unknown>> = {}
  let handlers: Record<string, (input: never) => Effect.Effect<unknown>> = {}
  const registry = [
    { id: "mail_send", name: "send", options: mcp("mail", "send") },
    { id: "docs_read", name: "read", options: mcp("docs", "read") },
    // Встроенный инструмент с именем, похожим на инструмент сервера, — не его.
    { id: "mail_digest", name: "mail_digest" },
  ]
  const parents: Record<string, string> = { helper: "chat" }
  const base = host()
  yield* BuffChatConnectionsPlugin.Plugin.effect(
    host({
      storage: {
        ...base.storage,
        get: (key) => Effect.sync(() => stored.get(key) as never),
        set: (key, value) => Effect.sync(() => void stored.set(key, value)),
      },
      rpc: Object.assign(() => Effect.die("unused"), {
        register: (_definition: unknown, implementation: typeof handlers) =>
          Effect.sync(() => {
            handlers = implementation
            return { events: { emit: () => Effect.void } }
          }),
      }) as never,
      tool: {
        ...base.tool,
        list: () => Effect.sync(() => registry as never),
        hook: ((name: string, cb: never) => Effect.sync(() => void (hooks[`tool.${name}`] = cb))) as never,
      },
      permission: {
        ...base.permission,
        hook: ((name: string, cb: never) => Effect.sync(() => void (hooks[`permission.${name}`] = cb))) as never,
      },
      session: {
        hook: ((name: string, cb: never) => Effect.sync(() => void (hooks[`session.${name}`] = cb))) as never,
        get: ((input: { sessionID: string }) =>
          Effect.succeed({ id: input.sessionID, parentID: parents[input.sessionID] })) as never,
      },
    }),
  )
  const change = (sessionID: string, server: string, on: boolean) =>
    handlers.change!({ sessionID, server, on } as never) as Effect.Effect<{ off: string[] }>
  const tools = (sessionID: string) =>
    Effect.gen(function* () {
      const event = { sessionID, tools: { mail_send: {}, docs_read: {}, mail_digest: {}, read: {} } }
      yield* hooks["session.context"]!(event as never)
      return Object.keys(event.tools)
    })
  const call = (sessionID: string, tool: string) =>
    hooks["tool.execute.before"]!({ sessionID, tool, input: {} } as never).pipe(
      Effect.as("ran"),
      Effect.catch((error: unknown) => Effect.succeed((error as { message: string }).message)),
    )
  const permit = (sessionID: string, action: string) =>
    Effect.gen(function* () {
      const event = { sessionID, action, resources: ["*"], effect: "allow" }
      yield* hooks["permission.evaluate"]!(event as never)
      return event.effect
    })
  // R14-05: правила, сужающие инструменты хода, — те же, что убирают их из каталога режима кода.
  const narrowed = (sessionID: string) =>
    Effect.gen(function* () {
      const event = { sessionID, agent: "build", rules: [] as unknown[] }
      yield* hooks["permission.tools"]!(event as never)
      return event.rules
    })
  return { change, tools, call, permit, narrowed, get: (sessionID: string) => handlers.get!({ sessionID } as never) }
})

describe("a connection turned off in one chat", () => {
  it.live("its tools leave the model's list, a call is refused, the permission denied — in that chat only", () =>
    Effect.gen(function* () {
      const chat = yield* rig()
      expect(yield* chat.change("chat", "mail", false)).toEqual({ off: ["mail"] })
      expect(yield* chat.get("chat")).toEqual({ off: ["mail"] })
      expect(yield* chat.tools("chat")).toEqual(["docs_read", "mail_digest", "read"])
      expect(yield* chat.call("chat", "mail_send")).toContain("«mail»")
      expect(yield* chat.call("chat", "mail_digest")).toBe("ran")
      expect(yield* chat.permit("chat", "mail_send")).toBe("deny")
      expect(yield* chat.permit("chat", "docs_read")).toBe("allow")
      // Другой чат подключение видит.
      expect(yield* chat.tools("other")).toEqual(["mail_send", "docs_read", "mail_digest", "read"])
      expect(yield* chat.call("other", "mail_send")).toBe("ran")
      expect(yield* chat.permit("other", "mail_send")).toBe("allow")
    }),
  )

  it.live("the chat's helper is held by it too; turned back on, the tools return", () =>
    Effect.gen(function* () {
      const chat = yield* rig()
      yield* chat.change("chat", "mail", false)
      expect(yield* chat.call("helper", "mail_send")).toContain("«mail»")
      expect(yield* chat.permit("helper", "mail_send")).toBe("deny")
      expect(yield* chat.change("chat", "mail", true)).toEqual({ off: [] })
      expect(yield* chat.call("chat", "mail_send")).toBe("ran")
      expect(yield* chat.tools("chat")).toContain("mail_send")
    }),
  )
})

// R14-05: каталог режима кода (и его поиск) строится из инструментов хода, суженных правилами; без
// этого модель видела инструменты выключенного сервера, писала к ним код и получала отказ.
describe("code mode of a chat with a connection off", () => {
  it.live("the turn's tools are narrowed by a deny rule per tool of the off server — in that chat and its helper", () =>
    Effect.gen(function* () {
      const chat = yield* rig()
      expect(yield* chat.narrowed("chat")).toEqual([])
      yield* chat.change("chat", "mail", false)
      const denied = [{ action: "mail_send", resource: "*", effect: "deny" }]
      expect(yield* chat.narrowed("chat")).toEqual(denied)
      expect(yield* chat.narrowed("helper")).toEqual(denied)
      expect(yield* chat.narrowed("other")).toEqual([])
    }),
  )
})

