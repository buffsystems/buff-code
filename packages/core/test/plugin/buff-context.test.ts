// Рабочий контекст Buff Code (#391): выбирается за каталогом из того, что разрешено.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { BuffContext } from "@opencode/schema/buff-context"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { BuffWorkContext } from "@opencode/core/buff/context"
import { testEffect } from "../lib/effect"
import { PluginTestLayerWithMcp as PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* BuffWorkContext.Plugin.effect(host)
})

/** A connector's developer gateway answering `workspace` as the backend's `list` does. */
function gateway() {
  const seen: Array<Record<string, unknown>> = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname !== "/v1/developer/workspace") return new Response(null, { status: 404 })
      seen.push((await request.json()) as Record<string, unknown>)
      return Response.json({
        ok: true,
        login: "ivan",
        orgs: ["acme", "retail"],
        projects: [
          { id: "acme/shop", name: "shop", org: "acme", kind: "dev" },
          { id: "retail/pos", name: "pos", org: "retail", kind: "dev" },
        ],
        repos: [{ id: "acme/cms", name: "cms", org: "acme", kind: "git" }],
        spaces: [{ id: "acme/handbook", name: "handbook", org: "acme", kind: "space" }],
      })
    },
  })
  return { server, seen }
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

const client = () => Effect.map(Rpc.Service, (rpc) => rpc.client(BuffContext.Rpc))

describe("BuffWorkContext (#391)", () => {
  it.effect("nothing is chosen in a new directory", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      expect(yield* (yield* client()).get()).toBeNull()
    }),
  )

  it.effect("without a sign-in there is nothing to choose from — and it says so", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const error = yield* (yield* client()).options().pipe(Effect.flip)
      expect(error).toMatchObject({ type: "signed_out" })
      expect(String((error as { message?: string }).message)).toContain("Вход в Buff не выполнен")
    }),
  )

  it.live("the choices come through the connector, read with the developer's own token", () =>
    Effect.acquireUseRelease(
      Effect.sync(gateway),
      ({ server, seen }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugin()
          const options = yield* (yield* client()).options()
          expect(seen).toEqual([{ token: "dev-access" }])
          expect(options).toEqual({
            orgs: ["acme", "retail"],
            projects: [
              { org: "acme", name: "shop" },
              { org: "retail", name: "pos" },
            ],
            spaces: [{ org: "acme", name: "handbook" }],
          })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("a choice within what is allowed is kept; «no project» is a choice too", () =>
    Effect.acquireUseRelease(
      Effect.sync(gateway),
      ({ server }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugin()
          const rpc = yield* client()
          const chosen = { org: "acme", project: "shop", spaces: ["handbook"] }
          expect(yield* rpc.set(chosen)).toEqual(chosen)
          expect(yield* rpc.get()).toEqual(chosen)
          const none = { org: "retail", project: null, spaces: [] }
          expect(yield* rpc.set(none)).toEqual(none)
          expect(yield* rpc.get()).toEqual(none)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("an organisation, project or space outside the grants is refused", () =>
    Effect.acquireUseRelease(
      Effect.sync(gateway),
      ({ server }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugin()
          const rpc = yield* client()
          for (const bad of [
            { org: "globex", project: null, spaces: [] },
            { org: "acme", project: "pos", spaces: [] },
            { org: "retail", project: "pos", spaces: ["handbook"] },
          ]) {
            const error = yield* rpc.set(bad).pipe(Effect.flip)
            expect(error).toMatchObject({ type: "not_allowed" })
          }
          expect(yield* rpc.get()).toBeNull()
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("the choice survives a restart", () =>
    Effect.acquireUseRelease(
      Effect.sync(gateway),
      ({ server }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugin()
          const chosen = { org: "acme", project: "shop", spaces: [] }
          yield* (yield* client()).set(chosen)
          yield* addPlugin() // a new instance of the plugin, the same storage
          expect(yield* (yield* client()).get()).toEqual(chosen)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  // #466: настройки десктопа открыты не в каталоге проекта, а подключение и модели показывать
  // надо — они смотрят в каталог, где контекст выбирали последним.
  it.effect("before any choice there is no directory to look at", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      expect(yield* (yield* client()).lastDirectory()).toBeNull()
    }),
  )

  it.live("the directory of the last choice is remembered", () =>
    Effect.acquireUseRelease(
      Effect.sync(gateway),
      ({ server }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          const host = yield* PluginHost.make(yield* Plugin.Service)
          yield* BuffWorkContext.Plugin.effect(host)
          const rpc = yield* client()
          yield* rpc.set({ org: "acme", project: "shop", spaces: [] })
          expect(yield* rpc.lastDirectory()).toBe(host.location.directory)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("a profile from before the last choice was recorded points at any directory with a choice", () =>
    Effect.gen(function* () {
      const host = yield* PluginHost.make(yield* Plugin.Service)
      yield* host.storage.set(BuffWorkContext.contextKey("/work/elsewhere"), {
        org: "retail",
        project: null,
        spaces: [],
      })
      yield* BuffWorkContext.Plugin.effect(host)
      expect(yield* (yield* client()).lastDirectory()).toBe("/work/elsewhere")
    }),
  )

  it.effect("each directory keeps its own choice", () =>
    Effect.sync(() => {
      expect(BuffWorkContext.contextKey("/work/a")).not.toBe(BuffWorkContext.contextKey("/work/b"))
    }),
  )

  // Рабочее дерево — новый каталог того же проекта: спрашивать контекст заново в каждом дереве
  // незачем, он берётся у проекта, пока в дереве не выбрали свой.
  it.effect("a worktree falls back to the choice of its project's main directory", () =>
    Effect.sync(() => {
      const worktree = { directory: "/trees/glowing-pixel", project: { canonical: "/work/shop" } }
      expect(BuffWorkContext.contextKeys(worktree)).toEqual([
        BuffWorkContext.contextKey("/trees/glowing-pixel"),
        BuffWorkContext.contextKey("/work/shop"),
      ])
      const main = { directory: "/work/shop", project: { canonical: "/work/shop" } }
      expect(BuffWorkContext.contextKeys(main)).toEqual([BuffWorkContext.contextKey("/work/shop")])
    }),
  )
})
