// A pasted sign-in code that the integration refuses (Buff, #966): the person reads the
// integration's own reason, not a bare "Authentication failed".
import { expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live(
  "completing a code sign-in with a refused code answers with the integration's reason",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("opencode-integration-code-")
      const context = yield* Layer.build(
        createRoutes({
          password: "secret",
          database: { path: ":memory:" },
          models: { fetch: false },
          fs: { filewatcher: false },
          config: { directory: tmp.path, project: false },
        }).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const post = (route: string, body?: unknown) =>
        Effect.promise(async (signal) => {
          const url = new URL(route, "http://opencode.local")
          url.searchParams.set("location[directory]", tmp.path)
          const response = await handler(
            new Request(url, {
              method: body === undefined ? "GET" : "POST",
              headers: { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
              signal,
            }),
          )
          const text = await response.text()
          return {
            status: response.status,
            text,
            body: (text.startsWith("{") ? JSON.parse(text) : {}) as Record<string, unknown>,
          }
        })

      // The list waits for the plugins: the integration is there once it answers.
      expect((yield* post("/api/integration")).status).toBe(200)
      // The Buff account's link-and-code sign-in: the page hands back `code#state`.
      const started = yield* post("/api/integration/buff-account/connect/oauth", { methodID: "code" })
      expect({ status: started.status, text: started.text.slice(0, 200) }).toMatchObject({ status: 200 })
      const attempt = started.body.data as { attemptID: string; mode: string }
      expect(attempt.mode).toBe("code")

      const refused = yield* post(`/api/integration/buff-account/connect/oauth/${attempt.attemptID}/complete`, {
        code: "bufa_X#a-state-of-another-attempt",
      })
      expect(refused.status).toBe(400)
      expect(refused.body.kind).toBe("integration_authorization")
      expect(String(refused.body.message)).toMatch(/another sign-in attempt|другой попытки входа/)
    }),
  15_000,
)
