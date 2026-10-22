// Модели организации в Buff Code (#370): провайдер «Buff» — дверь шлюза коннектора компании.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { BuffContext } from "@opencode/schema/buff-context"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { BuffModels } from "@opencode/core/buff/models"
import { BuffWorkContext } from "@opencode/core/buff/context"
import { BuffLogin } from "@opencode/core/buff/login"
import { testEffect } from "../lib/effect"
import { PluginTestLayerWithMcp as PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  // The sign-in registers the Buff integration the provider is available through.
  yield* BuffLogin.Plugin.effect(yield* PluginHost.make(plugin, "buff.login"))
  yield* BuffWorkContext.Plugin.effect(yield* PluginHost.make(plugin, "buff.context"))
})

/** The connector's gateway: the workspace lists and the organisation's models. */
function gateway(delayMs = 0) {
  const models: Array<Record<string, string | null>> = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      if (path === "/v1/developer/workspace")
        return Response.json({
          ok: true,
          orgs: ["acme", "retail"],
          projects: [{ name: "shop", org: "acme" }],
          spaces: [],
        })
      if (path === "/v1/models") {
        await Bun.sleep(delayMs)
        const org = request.headers.get("x-buff-org")
        models.push({ auth: request.headers.get("authorization"), org, project: request.headers.get("x-buff-project") })
        // Имя модели — от бэкенда (#435): у acme это тариф, у retail его нет.
        return Response.json({
          object: "list",
          data: [
            org === "acme"
              ? { id: "z-ai/glm-5.3-flash", object: "model", name: "OpenRouter (Сбалансированные модели)" }
              : { id: "qwen/qwen3-coder", object: "model" },
          ],
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { server, models }
}

const signIn = (connector: string) =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    yield* credentials.create({
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

function eventually<A>(effect: Effect.Effect<A>, done: (a: A) => boolean, left = 2000): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (done(value)) return value
    if (left === 0) return yield* Effect.fail(new Error("timed out"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, done, left - 1)
  })
}

describe("BuffModels (#370)", () => {
  it.effect("the work context rides as headers; «no project» sends none for it", () =>
    Effect.sync(() => {
      expect(BuffModels.contextHeaders(null)).toEqual({})
      expect(BuffModels.contextHeaders({ org: "acme", project: "shop", spaces: [] })).toEqual({
        "X-Buff-Org": "acme",
        "X-Buff-Project": "shop",
      })
      expect(BuffModels.contextHeaders({ org: "acme", project: null, spaces: [] })).toEqual({ "X-Buff-Org": "acme" })
      // Сессия Buff Code едет с каждым вызовом: бэкенд хранит ход в ней (#369).
      // …и вид вызова: работа или служебный (заголовок, сжатие) — кабинет прячет служебные (#373).
      expect(BuffModels.requestHeaders({ org: "acme", project: null, spaces: [] }, "ses_1", "title")).toEqual({
        "X-Buff-Org": "acme",
        "X-Buff-Session": "ses_1",
        "X-Buff-Call": "title",
      })
      // …и сообщение-ответ у рабочего вызова: под ним кабинет покажет ход (#439).
      expect(BuffModels.requestHeaders({ org: "acme", project: null, spaces: [] }, "ses_1", "primary", "msg_a1")).toEqual({
        "X-Buff-Org": "acme",
        "X-Buff-Session": "ses_1",
        "X-Buff-Message": "msg_a1",
        "X-Buff-Call": "primary",
      })
    }),
  )

  it.effect("the model list is read off an OpenAI-shaped answer, and nothing else", () =>
    Effect.sync(() => {
      expect(BuffModels.listedModels({ data: [{ id: "a" }, { id: "" }, { name: "b" }, null] })).toEqual([
        { id: "a", name: "a" },
      ])
      expect(BuffModels.listedModels({ error: "нет" })).toEqual([])
    }),
  )

  it.effect("a model is shown by the name the backend gave it — the tariff for ours (#435)", () =>
    Effect.sync(() => {
      expect(
        BuffModels.listedModels({ data: [{ id: "buff", name: "OpenRouter (Сбалансированные модели)" }, { id: "x", name: "" }] }),
      ).toEqual([
        { id: "buff", name: "OpenRouter (Сбалансированные модели)" },
        { id: "x", name: "x" },
      ])
    }),
  )

  it.live("without a chosen organisation there is no Buff provider", () =>
    Effect.acquireUseRelease(
      Effect.sync(gateway),
      ({ server, models }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugin()
          yield* Effect.promise(() => Bun.sleep(20))
          expect(yield* (yield* Provider.Service).get(BuffModels.providerID)).toBeUndefined()
          expect(models).toEqual([])
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("a chosen context has its models the moment the plugin is up — a console command asks at once", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => gateway(200)),
      ({ server }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          // The next start of the console, with the context chosen earlier.
          const plugin = yield* Plugin.Service
          const context = yield* PluginHost.make(plugin, "buff.context")
          yield* context.storage.set(BuffWorkContext.contextKey(context.location.directory), {
            org: "acme",
            project: null,
            spaces: [],
          })
          yield* BuffLogin.Plugin.effect(yield* PluginHost.make(plugin, "buff.login"))
          yield* BuffWorkContext.Plugin.effect(context)
          const model = yield* (yield* Model.Service).get(BuffModels.providerID, Model.ID.make("z-ai/glm-5.3-flash"))
          expect(model).toBeDefined()
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("choosing the organisation brings its model, served by the connector with the developer's token", () =>
    Effect.acquireUseRelease(
      Effect.sync(gateway),
      ({ server, models }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugin()
          const rpc = (yield* Rpc.Service).client(BuffContext.Rpc)
          yield* rpc.set({ org: "acme", project: "shop", spaces: [] })
          const modelState = yield* Model.Service
          const model = yield* eventually(
            modelState.get(BuffModels.providerID, Model.ID.make("z-ai/glm-5.3-flash")),
            (m) => m !== undefined,
          )
          expect(model?.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
          expect(model?.name).toBe("OpenRouter (Сбалансированные модели)")
          // The desktop's picker hides models released over half a year ago; the organisation's
          // model is current by definition — its admin chose it — so it must not read as 1970.
          expect(Date.now() - (model?.time.released ?? 0)).toBeLessThan(60_000)
          // …and it counts as its family's latest only with a family: the picker drops the rest.
          expect(String(model?.family)).toBe("z-ai/glm-5.3-flash")
          expect(yield* (yield* Provider.Service).get(BuffModels.providerID)).toMatchObject({
            name: "Buff",
            integrationID: "buff",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `${server.url.origin}/v1`, provider: "buff" },
          })
          expect(models.at(-1)).toEqual({ auth: "Bearer dev-access", org: "acme", project: "shop" })
          // What the desktop's picker and `buff models` read.
          const available = (yield* modelState.available()).map((m) => `${m.providerID}/${m.id}`)
          expect(available).toContain("buff/z-ai/glm-5.3-flash")

          // Another organisation — another route, another list.
          yield* rpc.set({ org: "retail", project: null, spaces: [] })
          yield* eventually(
            modelState.get(BuffModels.providerID, Model.ID.make("qwen/qwen3-coder")),
            (m) => m !== undefined,
          )
          expect(yield* modelState.get(BuffModels.providerID, Model.ID.make("z-ai/glm-5.3-flash"))).toBeUndefined()
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
})
