// Инструменты пространства в Buff Code (#368): после входа MCP коннектора прописан сам —
// адрес из входа, токен разработчика в каждом запросе. Отдельной настройки нет (#401).
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Mcp } from "@opencode/core/mcp/index"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { BuffWorkContext } from "@opencode/core/buff/context"
import { BuffLogin } from "@opencode/core/buff/login"
import { BuffTools } from "@opencode/core/buff/tools"
import { testEffect } from "../lib/effect"
import { PluginTestLayerWithMcp as PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

/** The connector's gateway answering MCP the way internal/devgate/mcp.go does. */
function gateway() {
  const auth: Array<string | null> = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== "/v1/mcp") return new Response(null, { status: 404 })
      auth.push(request.headers.get("authorization"))
      if (request.method !== "POST") return new Response(null, { status: 405 })
      const msg = (await request.json()) as { id?: number; method: string }
      if (msg.id === undefined) return new Response(null, { status: 202 })
      const reply = (result: unknown, headers: Record<string, string> = {}) =>
        Response.json({ jsonrpc: "2.0", id: msg.id, result }, { headers })
      if (msg.method === "initialize")
        return reply(
          {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "buff-connector", version: "1" },
            instructions: "Инструменты пространства компании",
          },
          { "Mcp-Session-Id": "s1" },
        )
      if (msg.method === "tools/list")
        return reply({
          tools: [
            {
              name: "files__read",
              description: "Read a file.",
              inputSchema: { type: "object" },
              annotations: { readOnlyHint: true },
            },
          ],
        })
      return Response.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no" } })
    },
  })
  return { server, auth }
}

const signIn = (connector: string) =>
  Effect.gen(function* () {
    yield* (yield* Credential.Service).create({
      integrationID: Integration.ID.make("buff"),
      value: Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("device"),
        access: "dev-access",
        refresh: "dev-refresh",
        expires: Date.now() + 15 * 60_000,
        metadata: { connector, login: "ivan", org: "acme" },
      }),
    })
  })

const addPlugins = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  yield* BuffLogin.Plugin.effect(yield* PluginHost.make(plugin, "buff.login"))
  yield* BuffWorkContext.Plugin.effect(yield* PluginHost.make(plugin, "buff.context"))
})

function eventually<A>(effect: Effect.Effect<A>, done: (a: A) => boolean, left = 3000): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (done(value)) return value
    if (left === 0) return yield* Effect.fail(new Error("timed out"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, done, left - 1)
  })
}

describe("BuffTools (#368)", () => {
  it.effect("the connector's MCP is the gateway's /v1/mcp with the developer's token", () =>
    Effect.sync(() => {
      expect(BuffTools.serverConfig(undefined)).toBeUndefined()
      expect(BuffTools.serverConfig({ connector: "https://c.local:8767", token: "T" })).toEqual({
        type: "remote",
        url: "https://c.local:8767/v1/mcp",
        headers: { Authorization: "Bearer T" },
        oauth: false,
      })
    }),
  )

  it.live("signed in, Buff Code sees the company's tools through the connector — nothing to configure", () =>
    Effect.acquireUseRelease(
      Effect.sync(gateway),
      ({ server, auth }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugins()
          const mcp = yield* Mcp.Service
          const tools = yield* eventually(mcp.tools(), (list) => list.some((t) => t.server === BuffTools.serverName))
          expect(tools.find((t) => t.server === BuffTools.serverName)?.name).toBe("files__read")
          expect(auth.every((a) => a === "Bearer dev-access")).toBe(true)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("without a sign-in there is no Buff MCP", () =>
    Effect.gen(function* () {
      yield* addPlugins()
      const servers = yield* (yield* Mcp.Service).servers()
      expect(servers.some((s) => s.name === BuffTools.serverName)).toBe(false)
    }),
  )
})
