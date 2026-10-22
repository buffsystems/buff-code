// Свои OpenAI-совместимые провайдеры из интерфейса (#562): запись в файле пользователя, ключ в
// хранилище, модели с сервера и проверка модели настоящим запросом — к поддельному серверу.
import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Layer, Schedule } from "effect"
import { BuffProvider } from "@opencode/schema/buff-provider"
import { Document, Event, Info } from "@opencode/schema/config"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { BuffProviderPlugin } from "@opencode/core/buff/provider"
import { parse } from "jsonc-parser"
import { testEffect } from "../lib/effect"
import { PluginTestLayerWithModels } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayerWithModels, Config.testLayer()))

/** OpenAI-совместимый сервер: пускает только с ключом `sk-good`, на всё отвечает «OK». */
function fakeServer() {
  const seen: string[] = []
  const limits: (number | undefined)[] = []
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const auth = request.headers.get("authorization") ?? ""
      seen.push(auth)
      if (auth !== "Bearer sk-good") return Response.json({ error: { message: "bad key", code: 401 } }, { status: 401 })
      const url = new URL(request.url)
      if (url.pathname === "/v1/models") return Response.json({ object: "list", data: [{ id: "m2" }, { id: "m1" }] })
      const body = (await request.json()) as { stream?: boolean; max_tokens?: number; max_completion_tokens?: number }
      limits.push(body.max_tokens ?? body.max_completion_tokens)
      if (!body.stream)
        return Response.json({
          id: "c1",
          object: "chat.completion",
          created: 1,
          model: "m1",
          choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      return new Response(chunk({ role: "assistant", content: "OK" }, null) + chunk({}, "stop") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  return { server, seen, limits, baseURL: `http://127.0.0.1:${server.port}/v1` }
}

const setup = Effect.gen(function* () {
  const host = yield* PluginHost.make(yield* Plugin.Service, "buff.provider")
  const user = yield* Effect.acquireRelease(
    Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "buff-provider-user-"))),
    (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
  )
  const fake = yield* Effect.acquireRelease(Effect.sync(fakeServer), (fake) =>
    Effect.promise(() => fake.server.stop(true)),
  )
  yield* ConfigProviderPlugin.Plugin.effect(host)
  yield* BuffProviderPlugin.register(host, { userDirectory: user, settle: "0 millis", timeout: "10 seconds" })
  const config = yield* Config.Test
  const bus = yield* Bus.Service
  const file = path.join(user, "buffcode.jsonc")
  // Файлы в тестовом слое никто не перечитывает — тест делает это сам, как наблюдатель за файлами.
  const loaded = Effect.promise(() => fs.readFile(file, "utf8")).pipe(
    Effect.flatMap((text) =>
      config.setEntries([
        new Document({ type: "document", path: AbsolutePath.make(file), info: new Info(parse(text)) }),
      ]),
    ),
    Effect.andThen(bus.publish(Event.Updated, {})),
  )
  const providers = yield* Provider.Service
  const ready = (id: string) =>
    // Модель заводится, когда ядро перечитало конфигурацию; под нагрузкой это не мгновенно.
    providers.get(Provider.ID.make(id)).pipe(
      Effect.flatMap((provider) => (provider ? Effect.void : Effect.fail("not yet"))),
      Effect.retry({ schedule: Schedule.spaced("20 millis"), times: 1000 }),
      Effect.orDie,
    )
  return { rpc: (yield* Rpc.Service).client(BuffProvider.Rpc), fake, file, loaded, ready }
})

const draft = (baseURL: string, key?: string) => ({
  id: "litellm",
  name: "LiteLLM",
  baseURL,
  models: [{ id: "m1" }],
  ...(key === undefined ? {} : { key }),
})

describe("BuffProvider (#562)", () => {
  it.live("the server's models are listed; a wrong key is the provider's refusal", () =>
    Effect.gen(function* () {
      const { rpc, fake } = yield* setup
      expect(yield* rpc.models({ baseURL: fake.baseURL, key: "sk-good" })).toEqual({ models: ["m1", "m2"] })
      expect(yield* rpc.models({ baseURL: fake.baseURL, key: "sk-bad" })).toEqual({
        error: { type: "provider.auth", status: 401, message: "bad key" },
      })
      const down = yield* rpc.models({ baseURL: "http://127.0.0.1:1/v1" })
      expect("error" in down && down.error.type).toBe("provider.transport")
    }),
  )

  it.live("a saved provider lands in the user's file without its key, and answers the check", () =>
    Effect.gen(function* () {
      const { rpc, fake, file, loaded, ready } = yield* setup
      yield* rpc.save(draft(fake.baseURL, "sk-good"))
      const text = yield* Effect.promise(() => fs.readFile(file, "utf8"))
      expect(text).not.toContain("sk-good")
      expect(parse(text).providers.litellm.settings).toEqual({ baseURL: fake.baseURL })
      yield* loaded
      expect(yield* rpc.list()).toEqual([
        { id: "litellm", name: "LiteLLM", baseURL: fake.baseURL, models: [{ id: "m1" }], hasKey: true },
      ])
      yield* ready("litellm")
      const checked = yield* rpc.test({ providerID: "litellm", modelID: "m1" })
      expect(checked).toMatchObject({ text: "OK" })
      expect(fake.seen.at(-1)).toBe("Bearer sk-good")
      // Проверке не нужен весь предел ответа модели: ключ с малым лимитом иначе получает 402.
      expect(fake.limits.at(-1)).toBe(1024)
      // Сохранённый ключ годится и для списка моделей при правке.
      expect(yield* rpc.models({ baseURL: fake.baseURL, id: "litellm" })).toEqual({ models: ["m1", "m2"] })
      // На другой адрес сохранённый ключ не уходит.
      const elsewhere = fake.baseURL.replace("/v1", "/other/v1")
      yield* rpc.models({ baseURL: elsewhere, id: "litellm" })
      expect(fake.seen.at(-1)).toBe("")
    }),
  )

  it.live("a replaced key takes over; the check reads the refusal as the provider's", () =>
    Effect.gen(function* () {
      const { rpc, fake, loaded, ready } = yield* setup
      yield* rpc.save(draft(fake.baseURL, "sk-good"))
      yield* loaded
      yield* ready("litellm")
      yield* rpc.save(draft(fake.baseURL, "sk-bad"))
      const checked = yield* rpc.test({ providerID: "litellm", modelID: "m1" })
      expect(checked).toMatchObject({ error: { type: "provider.auth", status: 401 } })
      // Без нового ключа остаётся прежний.
      yield* rpc.save(draft(fake.baseURL))
      expect((yield* rpc.list())[0]?.hasKey).toBe(true)
    }),
  )

  it.live("a model nobody serves is no route; a wrong form is refused", () =>
    Effect.gen(function* () {
      const { rpc } = yield* setup
      expect(yield* rpc.test({ providerID: "nobody", modelID: "x" })).toMatchObject({
        error: { type: "provider.no-route" },
      })
      const refused = yield* rpc.save({ ...draft("localhost:4000"), key: "k" }).pipe(Effect.flip)
      expect(refused).toMatchObject({ type: "invalid" })
    }),
  )

  it.live("a removed provider leaves neither the file entry nor the key", () =>
    Effect.gen(function* () {
      const { rpc, fake, file, loaded } = yield* setup
      yield* rpc.save(draft(fake.baseURL, "sk-good"))
      yield* loaded
      yield* rpc.remove({ id: "litellm" })
      expect(parse(yield* Effect.promise(() => fs.readFile(file, "utf8"))).providers).toEqual({})
      yield* loaded
      expect(yield* rpc.list()).toEqual([])
    }),
  )
})
