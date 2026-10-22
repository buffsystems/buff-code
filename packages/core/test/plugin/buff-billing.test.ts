// Остаток и расход в Buff Code (#455): ядро читает их через шлюз коннектора токеном
// разработчика для организации, выбранной в каталоге.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { BuffBilling } from "@opencode/schema/buff-billing"
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

const BILLING = {
  org: "acme",
  balance_rub: 20,
  days_left: 2,
  low: true,
  exhausted: false,
  tariff: "Команда",
  price_input_rub_per_m: 90,
  price_output_rub_per_m: 180,
  mine: { window_days: 30, total_rub: 100, days: [{ day: "2026-10-01", rub: 100 }] },
  cabinet_url: "https://dev.example/app",
}

function gateway(billing: () => Response) {
  const seen: Array<Record<string, unknown>> = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      if (path === "/v1/developer/workspace")
        return Response.json({ ok: true, orgs: ["acme"], projects: [], spaces: [] })
      if (path === "/v1/developer/billing") {
        seen.push((await request.json()) as Record<string, unknown>)
        return billing()
      }
      return new Response(null, { status: 404 })
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

const clients = () =>
  Effect.map(Rpc.Service, (rpc) => ({ billing: rpc.client(BuffBilling.Rpc), context: rpc.client(BuffContext.Rpc) }))

const withGateway = <A, E, R>(
  billing: () => Response,
  use: (gate: ReturnType<typeof gateway>) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => gateway(billing)),
    use,
    ({ server }) => Effect.promise(() => server.stop(true)),
  )

describe("BuffBilling (#455)", () => {
  it.effect("without a sign-in it says so", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const error = yield* (yield* clients()).billing.get().pipe(Effect.flip)
      expect(error).toMatchObject({ type: "signed_out" })
    }),
  )

  it.live("without a chosen organisation there is nothing to ask about", () =>
    withGateway(
      () => Response.json({ ok: true, billing: BILLING }),
      ({ server, seen }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugin()
          const error = yield* (yield* clients()).billing.get().pipe(Effect.flip)
          expect(error).toMatchObject({ type: "no_context" })
          expect(seen).toEqual([])
        }),
    ),
  )

  it.live("the balance of the chosen organisation, read with the developer's own token", () =>
    withGateway(
      () => Response.json({ ok: true, billing: BILLING }),
      ({ server, seen }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugin()
          const rpc = yield* clients()
          yield* rpc.context.set({ org: "acme", project: null, spaces: [] })
          const info = yield* rpc.billing.get()
          expect(seen).toEqual([{ token: "dev-access", org: "acme" }])
          expect(info).toMatchObject({ org: "acme", balanceRub: 20, low: true, cabinetUrl: "https://dev.example/app" })
          expect(info.mine.days).toEqual([{ day: "2026-10-01", rub: 100 }])
        }),
    ),
  )

  it.live("a refusal or an answer without a balance is said as it is, not shown as zero", () =>
    withGateway(
      () => Response.json({ ok: false, error: "сведения о расходе сейчас недоступны" }, { status: 403 }),
      ({ server }) =>
        Effect.gen(function* () {
          yield* signIn(server.url.origin)
          yield* addPlugin()
          const rpc = yield* clients()
          yield* rpc.context.set({ org: "acme", project: null, spaces: [] })
          const error = yield* rpc.billing.get().pipe(Effect.flip)
          expect(error).toMatchObject({ type: "unreachable" })
          expect(String((error as { message?: string }).message)).toContain("сведения о расходе сейчас недоступны")
        }),
    ),
  )
})
