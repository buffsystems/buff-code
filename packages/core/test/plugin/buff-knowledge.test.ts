// База знаний организации в Buff Code (#371): после входа сервер «knowledge» прописан сам —
// MCP знаний на шлюзе коннектора, токен разработчика и рабочий контекст (#391) в заголовках.
// Сменился контекст — знания перечитываются.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { BuffContext } from "@opencode/schema/buff-context"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Mcp } from "@opencode/core/mcp/index"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { BuffWorkContext } from "@opencode/core/buff/context"
import { BuffLogin } from "@opencode/core/buff/login"
import { BuffTools } from "@opencode/core/buff/tools"
import { testEffect } from "../lib/effect"
import { PluginTestLayerWithMcp as PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

/** The gateway: the workspace lists (#391) and the knowledge MCP as devgate/knowledge.go serves it. */
function gateway() {
  const seen: Array<Record<string, string | null>> = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      if (path === "/v1/developer/workspace")
        return Response.json({
          ok: true,
          orgs: ["acme"],
          projects: [{ name: "shop", org: "acme" }],
          spaces: [{ name: "handbook", org: "acme" }],
        })
      if (path !== "/v1/knowledge/mcp" && path !== "/v1/repos/mcp") return new Response(null, { status: 404 })
      const kind = path === "/v1/repos/mcp" ? "РЕПОЗИТОРИИ" : "ЗНАНИЯ"
      if (request.method !== "POST") return new Response(null, { status: 405 })
      const context = {
        auth: request.headers.get("authorization"),
        org: request.headers.get("x-buff-org"),
        project: request.headers.get("x-buff-project"),
        spaces: request.headers.get("x-buff-spaces"),
      }
      seen.push(context)
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
            instructions: `${kind} ${context.org ?? "-"} › ${context.project || "без проекта"} · ${context.spaces || "нет"}`,
          },
          { "Mcp-Session-Id": `s${seen.length}` },
        )
      if (msg.method === "tools/list")
        return reply({
          tools: [
            {
              name: "read_entry",
              description: "Прочитать запись.",
              inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
              annotations: { readOnlyHint: true },
            },
          ],
        })
      return Response.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no" } })
    },
  })
  return { server, seen }
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

const client = () => Effect.map(Rpc.Service, (rpc) => rpc.client(BuffContext.Rpc))

function eventually<A, R>(
  effect: Effect.Effect<A, never, R>,
  done: (a: A) => boolean,
  left = 3000,
): Effect.Effect<A, Error, R> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (done(value)) return value
    if (left === 0) return yield* Effect.fail(new Error("timed out"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, done, left - 1)
  })
}

const instructionsOf = (server: string) =>
  Effect.gen(function* () {
    const all = yield* (yield* Mcp.Service).instructions()
    return all.find((item) => item.server === server)?.instructions ?? ""
  })
const knowledgeText = instructionsOf(BuffTools.knowledgeServerName)

describe("BuffTools knowledge (#371)", () => {
  it.effect("the knowledge MCP is the gateway's /v1/knowledge/mcp with the token and the work context", () =>
    Effect.sync(() => {
      const me = { connector: "https://c.local:8767", token: "T" }
      expect(BuffTools.knowledgeConfig(undefined, null)).toBeUndefined()
      expect(BuffTools.knowledgeConfig(me, null, "ru")).toEqual({
        type: "remote",
        url: "https://c.local:8767/v1/knowledge/mcp",
        headers: { Authorization: "Bearer T", "X-Buff-Lang": "ru" },
        oauth: false,
        codemode: false,
      })
      expect(
        BuffTools.knowledgeConfig(me, { org: "acme", project: "shop", spaces: ["handbook", "wiki"] }, "en")?.headers,
      ).toEqual({
        Authorization: "Bearer T",
        "X-Buff-Lang": "en",
        "X-Buff-Org": "acme",
        "X-Buff-Project": "shop",
        "X-Buff-Spaces": "handbook,wiki",
      })
      expect(BuffTools.knowledgeConfig(me, { org: "acme", project: null, spaces: [] }, "ru")?.headers).toEqual({
        Authorization: "Bearer T",
        "X-Buff-Lang": "ru",
        "X-Buff-Org": "acme",
      })
    }),
  )

  it.live("signed in with a context, the model gets the organisation's knowledge; a new context re-reads it", () =>
    Effect.acquireUseRelease(
      Effect.sync(gateway),
      ({ server, seen }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugins()
          yield* (yield* client()).set({ org: "acme", project: "shop", spaces: ["handbook"] })
          expect(yield* eventually(knowledgeText, (text) => text.includes("shop"))).toBe(
            "ЗНАНИЯ acme › shop · handbook",
          )
          // The project's repositories (#372): their own server, the same context.
          expect(yield* eventually(instructionsOf(BuffTools.reposServerName), (text) => text.includes("shop"))).toBe(
            "РЕПОЗИТОРИИ acme › shop · handbook",
          )
          const tools = yield* eventually((yield* Mcp.Service).tools(), (list) =>
            list.some((t) => t.server === BuffTools.knowledgeServerName),
          )
          expect(tools.find((t) => t.server === BuffTools.knowledgeServerName)?.name).toBe("read_entry")
          expect(seen.every((s) => s.auth === "Bearer dev-access")).toBe(true)

          yield* (yield* client()).set({ org: "acme", project: null, spaces: [] })
          expect(yield* eventually(knowledgeText, (text) => text.includes("без проекта"))).toBe(
            "ЗНАНИЯ acme › без проекта · нет",
          )
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("the repositories MCP is the gateway's /v1/repos/mcp — native tools, the same context (#372)", () =>
    Effect.sync(() => {
      const me = { connector: "https://c.local:8767", token: "T" }
      expect(BuffTools.reposConfig(undefined, null)).toBeUndefined()
      expect(BuffTools.reposConfig(me, { org: "acme", project: "shop", spaces: [] }, "en")).toEqual({
        type: "remote",
        url: "https://c.local:8767/v1/repos/mcp",
        headers: { Authorization: "Bearer T", "X-Buff-Lang": "en", "X-Buff-Org": "acme", "X-Buff-Project": "shop" },
        oauth: false,
        codemode: false,
      })
    }),
  )

  it.live("without a sign-in there is no knowledge server", () =>
    Effect.gen(function* () {
      yield* addPlugins()
      const servers = yield* (yield* Mcp.Service).servers()
      expect(servers.some((s) => s.name === BuffTools.knowledgeServerName)).toBe(false)
    }),
  )
})
