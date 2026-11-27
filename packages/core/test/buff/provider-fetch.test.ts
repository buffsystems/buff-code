// Провайдер, до которого не дойти по HTTP (#966): на запрос слоя моделей отвечает он сам.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { BuffProviderFetch } from "../../src/buff/provider-fetch"

describe("ответчик провайдера", () => {
  test("пока не назван — его нет; назван — отвечает; снят — снова нет", () => {
    expect(BuffProviderFetch.get("p-one")).toBeUndefined()
    const fetch = async () => new Response("ok")
    const remove = BuffProviderFetch.register("p-one", fetch)
    expect(BuffProviderFetch.get("p-one")).toBe(fetch)
    expect(BuffProviderFetch.get("p-other")).toBeUndefined()
    remove()
    expect(BuffProviderFetch.get("p-one")).toBeUndefined()
  })

  test("каталогов несколько — закрытие одного не лишает ответчика остальные", () => {
    const first = async () => new Response("first")
    const second = async () => new Response("second")
    const removeFirst = BuffProviderFetch.register("p-two", first)
    const removeSecond = BuffProviderFetch.register("p-two", second)
    expect(BuffProviderFetch.get("p-two")).toBe(second)
    removeSecond()
    expect(BuffProviderFetch.get("p-two")).toBe(first)
    removeFirst()
    removeFirst()
    expect(BuffProviderFetch.get("p-two")).toBeUndefined()
  })

  test("запрос слоя моделей отдаётся ответчику целиком — метод, адрес, заголовки, тело; ответ возвращается", async () => {
    const seen: Array<{ method: string; url: string; tag: string | null; body: string }> = []
    const response = await Effect.runPromise(
      BuffProviderFetch.answer(
        async (request) => {
          seen.push({
            method: request.method,
            url: request.url,
            tag: request.headers.get("x-buff-session"),
            body: await request.text(),
          })
          return new Response("data: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
        },
        HttpClientRequest.post("https://account.buff.invalid/v1/chat/completions").pipe(
          HttpClientRequest.setHeader("X-Buff-Session", "ses_1"),
          HttpClientRequest.bodyText('{"model":"fast"}', "application/json"),
        ),
      ).pipe(
        Effect.flatMap((reply) =>
          Effect.map(reply.text, (text) => ({ status: reply.status, type: reply.headers["content-type"], text })),
        ),
      ),
    )
    expect(seen).toEqual([
      {
        method: "POST",
        url: "https://account.buff.invalid/v1/chat/completions",
        tag: "ses_1",
        body: '{"model":"fast"}',
      },
    ])
    expect(response).toEqual({ status: 200, type: "text/event-stream", text: "data: {}\n\n" })
  })
})
